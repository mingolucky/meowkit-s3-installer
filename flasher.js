// SPDX-License-Identifier: GPL-2.0-or-later
// ESP32-S3 RTC reset/watchdog backports follow Espressif esptool v4.9.0:
// https://github.com/espressif/esptool/blob/v4.9.0/esptool/targets/esp32s3.py
// and MeowKit firmware build_scripts/esptool_meowkit.py.
import { delay } from "./serial.js";

export const SDK_URL = "https://unpkg.com/esptool-js@0.6.0/bundle.js";
export const loadSdk = () => import(SDK_URL);

export async function loadRelease(manifestUrl, fetcher = fetch) {
  const response = await fetcher(manifestUrl, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load the firmware manifest. Please try again.");
  const manifest = await response.json();
  const build = manifest.builds?.find(item => item.chipFamily === "ESP32-S3");
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || build?.parts?.length !== 1 || build.parts[0].offset !== 0)
    throw new Error("The installer requires a complete ESP32-S3 firmware image at address 0x0.");
  const imageUrl = new URL(build.parts[0].path, manifestUrl);
  if (imageUrl.origin !== new URL(manifestUrl).origin || !imageUrl.pathname.endsWith(".bin"))
    throw new Error("Unexpected firmware image location.");
  return { manifest, imageUrl, checksumUrl: new URL("SHA256SUMS.txt", imageUrl) };
}

export async function downloadImage(release, fetcher = fetch, cryptoApi = crypto) {
  const [binary, checksums] = await Promise.all([
    fetcher(release.imageUrl, { cache: "no-store" }), fetcher(release.checksumUrl, { cache: "no-store" })
  ]);
  if (!binary.ok || !checksums.ok) throw new Error("Could not download the firmware and its checksum. Please try again.");
  const bytes = new Uint8Array(await binary.arrayBuffer());
  const text = await checksums.text();
  const name = decodeURIComponent(release.imageUrl.pathname.split("/").pop());
  const entry = text.split(/\r?\n/).map(line => line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i))
    .find(match => match && match[2] === name);
  const hash = Array.from(new Uint8Array(await cryptoApi.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
  if (!entry || entry[1].toLowerCase() !== hash) throw new Error("Firmware checksum verification failed. Installation was stopped.");
  if (bytes.length <= 0x10000 || bytes.length > 16 * 1024 * 1024 || bytes[0] !== 0xe9 || bytes[0x10000] !== 0xe9 ||
      new DataView(bytes.buffer, bytes.byteOffset).getUint16(12, true) !== 9)
    throw new Error("The downloaded file is not a complete MeowKit ESP32-S3 image.");
  return bytes;
}

export async function disableUsbWatchdogs(loader) {
  if (loader.chip.CHIP_NAME !== "ESP32-S3") throw new Error("This installer supports MeowKit ESP32-S3 devices only.");
  if (((await loader.readReg(0x3fcef14c)) & 0xff) !== 4) return;
  await loader.writeReg(0x600080b0, 0x50d83aa1);
  await loader.writeReg(0x60008098, 0);
  await loader.writeReg(0x600080b0, 0);
  await loader.writeReg(0x600080b8, 0x8f1d312a);
  await loader.writeReg(0x600080b4, ((await loader.readReg(0x600080b4)) | (1 << 31)) >>> 0);
  await loader.writeReg(0x600080b8, 0);
}

export async function restartApplication(loader) {
  await loader.writeReg(0x6000812c, 0, 1); // Clear FORCE_DOWNLOAD_BOOT before restarting.
  await loader.writeReg(0x600080b0, 0x50d83aa1);
  await loader.writeReg(0x6000809c, 2000);
  try {
    await loader.writeReg(0x60008098, ((1 << 31) | (5 << 28) | (1 << 8) | 2) >>> 0);
  } catch (error) {
    // The last command can lose its reply because it resets the USB device.
    if (!/disconnect|device.*lost|network|readable|timeout|read.*undefined/i.test(String(error))) throw error;
  }
}

export async function flashFirmware({ sdk, port, release, erase = false, status = () => {}, log = () => {},
  fetcher = fetch, cryptoApi = crypto, wait = delay }) {
  status("downloading", "Downloading and verifying firmware…");
  const bytes = await downloadImage(release, fetcher, cryptoApi);
  const transport = new sdk.Transport(port);
  class MeowKitLoader extends sdk.ESPLoader {
    async runStub() {
      await disableUsbWatchdogs(this);
      return super.runStub();
    }
  }
  const loader = new MeowKitLoader({ transport, baudrate: 115200,
    terminal: { clean() {}, write: log, writeLine: log } });
  let written = false;
  let restartError;
  try {
    status("connecting", "Connecting to MeowKit's download port…");
    await loader.main("no_reset"); // The selected ROM port is already in download mode.
    if (loader.chip.CHIP_NAME !== "ESP32-S3") throw new Error("The selected device is not an ESP32-S3.");
    const id = await loader.readFlashId();
    const capacity = (id >>> 16) & 0xff;
    if (capacity < 24 || capacity > 30) throw new Error("MeowKit requires a working 16 MB or larger flash chip.");
    if (erase) {
      status("erasing", "Erasing device flash. Keep MeowKit connected…");
      await loader.eraseFlash();
    }
    status("writing", "Installing firmware. Keep MeowKit connected…", 0);
    await loader.writeFlash({ fileArray: [{ data: bytes, address: 0 }], flashSize: "keep", flashMode: "keep",
      flashFreq: "keep", eraseAll: false, compress: true,
      reportProgress: (_index, done, total) => status("writing", "Installing firmware. Keep MeowKit connected…", Math.floor(done * 100 / total)) });
    written = true;
    status("restarting", "Firmware installed. Restarting MeowKit…", 100);
    try { await restartApplication(loader); } catch (error) { restartError = error; log(String(error)); }
    await wait(350);
  } finally {
    try { await transport.disconnect(); } catch (error) { log(String(error)); }
  }
  return { written, restartError };
}
