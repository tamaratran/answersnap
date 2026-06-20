/**
 * Screen capture module.
 *
 * Uses screenshot-desktop to capture the primary display as JPEG.
 * The overlay window is automatically excluded from the capture because
 * it has setContentProtection(true) / WDA_EXCLUDEFROMCAPTURE set.
 */

const screenshot = require("screenshot-desktop");

async function captureScreen() {
  // Capture the primary display as JPEG buffer
  const imgBuffer = await screenshot({ format: "jpg" });
  const base64 = imgBuffer.toString("base64");
  return `data:image/jpeg;base64,${base64}`;
}

module.exports = { captureScreen };
