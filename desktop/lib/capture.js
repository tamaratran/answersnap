/**
 * Screen capture module.
 *
 * Uses screenshot-desktop to capture the primary display as PNG.
 * The overlay window is automatically excluded from the capture because
 * it has setContentProtection(true) / WDA_EXCLUDEFROMCAPTURE set.
 */

const screenshot = require("screenshot-desktop");

async function captureScreen() {
  // Capture the primary display as JPEG buffer
  const imgBuffer = await screenshot({ format: "png" });
  const base64 = imgBuffer.toString("base64");
  return `data:image/png;base64,${base64}`;
}

module.exports = { captureScreen };
