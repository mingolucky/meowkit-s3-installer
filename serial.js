// USB identity matches MeowKit firmware v1.0.4 and the ESP32-S3 ROM downloader.
export const APP_FILTER = { usbVendorId: 0x303a, usbProductId: 0x0002 };
export const ROM_FILTER = { usbVendorId: 0x303a, usbProductId: 0x1001 };

export function kind(port) {
  const info = port.getInfo();
  if (info.usbVendorId !== 0x303a) return "other";
  return info.usbProductId === 0x0002 ? "app" : info.usbProductId === 0x1001 ? "rom" : "other";
}

function check(signal) {
  if (signal?.aborted) throw new DOMException("Connection cancelled", "AbortError");
}

export function delay(ms, signal) {
  check(signal);
  return new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); reject(new DOMException("Connection cancelled", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
    signal?.addEventListener("abort", stop, { once: true });
  });
}

export async function chooseDownloadPort(serial = navigator.serial) {
  // requestPort must be called directly from a user click, not from a timer.
  const port = await serial.requestPort({ filters: [ROM_FILTER] });
  if (kind(port) !== "rom") throw new Error("Select MeowKit's USB JTAG/serial debug unit download port.");
  return port;
}

export async function prepareDownload({ serial = navigator.serial, signal, status = () => {},
  wait = delay, now = () => performance.now(), permissionDelay = 2500, timeout = 12000 } = {}) {
  check(signal);
  // Keep the initial permission request inside the original click gesture.
  const source = await serial.requestPort({ filters: [APP_FILTER, ROM_FILTER] });
  check(signal);
  if (kind(source) === "rom") return { port: source, mode: "already-downloading" };
  if (kind(source) !== "app") throw new Error("Select the MeowKit application port.");

  const before = await serial.getPorts();
  const existingRom = new Set(before.filter(port => kind(port) === "rom" && port.connected !== false));
  const downloadPorts = ports => ports.filter(port => kind(port) === "rom" && port.connected !== false && !existingRom.has(port));
  let departed = false;
  let touchAttempted = false;
  const onDisconnect = event => { if ((event.port || event.target) === source) departed = true; };
  serial.addEventListener("disconnect", onDisconnect);
  try {
    status("preparing", "Preparing MeowKit. Keep the USB cable connected…");
    try {
      await source.open({ baudRate: 115200 });
      check(signal);
      await source.setSignals({ dataTerminalReady: false, requestToSend: false });
      await wait(150, signal);
      await source.close();
      check(signal);
      touchAttempted = true;
      await source.open({ baudRate: 1200 });
      await source.setSignals({ dataTerminalReady: false, requestToSend: false });
      await wait(250, signal);
    } catch (error) {
      // Windows can report a lost USB device while the 1200bps request succeeds.
      if (!touchAttempted || error.name !== "NetworkError") throw error;
    } finally {
      if (source.readable || source.writable) {
        try { await source.close(); } catch { /* A restarted application port is already gone. */ }
      }
    }
    check(signal);
    status("waiting", "MeowKit is restarting into download mode…");
    const started = now();
    let disconnectedAt;
    while (now() - started < timeout) {
      check(signal);
      const ports = await serial.getPorts();
      check(signal);
      if (source.connected === false || !ports.includes(source)) departed = true;
      if (departed) {
        disconnectedAt ??= now();
        const candidates = downloadPorts(ports);
        if (candidates.length === 1) {
          await wait(400, signal); // Let the operating system finish opening the new USB interface.
          check(signal);
          const settled = downloadPorts(await serial.getPorts());
          check(signal);
          if (settled.length === 1 && settled[0] === candidates[0]) return { port: settled[0], mode: "automatic" };
          if (settled.length > 1) return { mode: "permission", reason: "multiple" };
        }
        if (candidates.length > 1) return { mode: "permission", reason: "multiple" };
        // A newly enumerated port may need a separate browser permission.
        if (now() - disconnectedAt >= permissionDelay) return { mode: "permission", reason: "new-permission" };
      }
      await wait(200, signal);
    }
    return { mode: "permission", reason: "timeout" };
  } finally {
    serial.removeEventListener("disconnect", onDisconnect);
  }
}
