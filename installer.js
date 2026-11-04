import { prepareDownload, chooseDownloadPort } from "./serial.js";
import { loadSdk, loadRelease, flashFirmware } from "./flasher.js";

const $ = id => document.getElementById(id);
const manifestUrl = new URL("./stable/manifest.json", location.href);
let sdk, release, port, controller;
let phase = "loading";

function status(next, message, progress) {
  phase = next;
  $("status").textContent = message;
  $("status").dataset.state = next;
  $("progress").hidden = !["downloading", "connecting", "erasing", "writing", "restarting"].includes(next);
  if (progress === undefined) $("progress").removeAttribute("value");
  else $("progress").value = progress;
  const busy = ["selecting", "preparing", "waiting", "downloading", "connecting", "erasing", "writing", "restarting"].includes(next);
  $("connect").disabled = busy || next === "loading";
  $("download-port").disabled = busy || next === "loading";
  $("install").hidden = !port;
  $("install").disabled = busy || !port;
  $("erase").disabled = busy;
  $("recovery-connect").disabled = busy || !sdk || !release;
  $("cancel").hidden = !["preparing", "waiting"].includes(next);
}

function log(message) {
  const lines = ($("log").textContent + String(message) + "\n").split("\n");
  $("log").textContent = lines.slice(-150).join("\n");
}

function message(error) {
  if (error.name === "NotFoundError") return "No port selected. You can try again when MeowKit is connected.";
  if (error.name === "AbortError") return "Connection cancelled. You can connect again when ready.";
  if (/open|busy|access|readable|locked|in use/i.test(String(error)))
    return "Could not open the USB port. Close PC Monitor and other serial applications, then try again.";
  return error.message || String(error);
}

function ready(selected) {
  port = selected;
  $("download-port").hidden = true;
  status("ready", `MeowKit is in download mode. Select Install v${release.manifest.version} to continue.`);
}

async function initialize() {
  sdk = release = undefined;
  if (!("serial" in navigator) || !window.isSecureContext) {
    status("unsupported", !window.isSecureContext ? "Open this installer over HTTPS or localhost." :
      "Use a desktop browser with Web Serial, such as Chrome or Edge.");
    $("connect").disabled = $("download-port").disabled = true;
    return;
  }
  status("loading", "Loading installer…");
  try {
    [sdk, release] = await Promise.all([loadSdk(), loadRelease(manifestUrl)]);
    $("version").textContent = `Latest stable version: v${release.manifest.version}`;
    $("install").textContent = `Install v${release.manifest.version}`;
    $("connect").textContent = "Connect MeowKit";
    status("idle", "Connect MeowKit with a USB data cable, then select Connect MeowKit.");
  } catch (error) {
    status("load-error", "Could not load the installer. Check your connection and try again.");
    $("connect").textContent = "Reload installer";
    $("download-port").disabled = true;
    log(error);
  }
}

$("connect").addEventListener("click", async () => {
  if (phase === "load-error") { location.reload(); return; }
  if (!sdk || !release) { await initialize(); return; }
  controller = new AbortController();
  port = undefined;
  $("download-port").hidden = true;
  status("selecting", "Select the MeowKit USB port in your browser.");
  try {
    const result = await prepareDownload({ signal: controller.signal, status });
    if (result.port) { ready(result.port); return; }
    $("download-port").hidden = false;
    const text = result.reason === "multiple" ? "More than one download port appeared. Select the port for your MeowKit." :
      result.reason === "timeout" ? "Automatic restart was not confirmed. Select the download port, retry, or use BOOT recovery below." :
        "MeowKit restarted. Your browser needs permission for its download port. Select the download port to continue.";
    status("permission", text);
  } catch (error) { status(error.name === "AbortError" ? "idle" : "error", message(error)); log(error); }
});

async function selectRom() {
  if (!sdk || !release) return;
  port = undefined;
  status("selecting", "Select USB JTAG/serial debug unit for your MeowKit.");
  try { ready(await chooseDownloadPort()); }
  catch (error) { status("error", message(error)); log(error); }
}
$("download-port").addEventListener("click", selectRom);
$("recovery-connect").addEventListener("click", () => {
  if (["idle", "ready", "permission", "error", "finished"].includes(phase)) selectRom();
});
$("cancel").addEventListener("click", () => controller?.abort());

$("install").addEventListener("click", async () => {
  if (!port || phase !== "ready" && phase !== "error") return;
  const selected = port;
  try {
    const result = await flashFirmware({ sdk, port: selected, release, erase: $("erase").checked, status, log });
    port = undefined;
    status("finished", result.restartError ?
      "Firmware installed. Power MeowKit off and on to finish restarting." :
      "Installation complete. MeowKit is restarting with the new firmware.");
  } catch (error) {
    status("error", message(error));
    log(error);
  }
});

window.addEventListener("beforeunload", event => {
  if (["downloading", "connecting", "erasing", "writing", "restarting"].includes(phase)) {
    event.preventDefault(); event.returnValue = "";
  }
});

initialize();
