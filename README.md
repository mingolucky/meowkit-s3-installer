# meowkit-s3-installer
Official web installer for MeowKit-S3 firmware.

Open **https://mingolucky.github.io/meowkit-s3-installer/** in Chrome or Edge on a desktop computer.

## Routine updates

1. Turn on MeowKit running firmware **v1.0.4 or later**, connect a USB data cable, and close PC Monitor or other serial applications.
2. Select **Connect MeowKit** and choose the application USB port. The installer opens it at 115200bps, closes it, then opens it at 1200bps to request download mode.
3. Keep the cable connected while USB disconnects and re-enumerates. A newly available, previously authorized download port is selected automatically when it is the only candidate. Otherwise select **Select download port** and choose **USB JTAG/serial debug unit**. Browsers require a user click to authorize a new port.
4. Select **Install**. The installer verifies the published SHA-256 checksum, writes the complete image at address `0x0`, and requests an automatic restart.

The application and ROM downloader have different USB identities (`303A:0002` and `303A:1001`). The installer does not reuse a pre-existing download port automatically or choose between multiple new download ports. Web Serial does not expose a hardware identity that can prove these two USB interfaces belong to the same board; connect one MeowKit at a time.

Back up settings before installing: the complete image can overwrite settings even when **Erase all flash** is unchecked. An interrupted flash can be retried through the download port. Use the BOOT recovery instructions on the page for first installation, older firmware, or an application that cannot start.

## Implementation and releases

This is a static GitHub Pages site; no Node.js build or server is required. `installer.js` manages the interface, `serial.js` handles the application-to-ROM handoff, and `flasher.js` uses the public API of Espressif's pinned [esptool-js v0.6.0](https://github.com/espressif/esptool-js/tree/v0.6.0), loaded from unpkg.

`flasher.js` includes ESP32-S3 USB watchdog and RTC reset compatibility logic adapted from [Espressif esptool v4.9.0](https://github.com/espressif/esptool/blob/v4.9.0/esptool/targets/esp32s3.py) and the firmware project's `build_scripts/esptool_meowkit.py`. Its license is GPL-2.0-or-later; see [LICENSES/GPL-2.0.txt](LICENSES/GPL-2.0.txt). The SDK retains its upstream license.

Each firmware release lives in `firmware/vX.Y.Z/` and contains the complete `meowkit-s3-vX.Y.Z.bin` and its `SHA256SUMS.txt`. Update `stable/manifest.json` to point to a new release; the page reads its version and file path from the manifest. Keep published firmware directories unchanged. Frontend-only changes do not require a firmware version bump.
