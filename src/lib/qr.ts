/**
 * QR codes for the car lot: drawn as SVG for printed slot labels and car tags,
 * and read from camera frames. Reading uses the phone's own barcode reader where
 * the browser has one (Chrome on Android: QR, Code 39/128 and Data Matrix, so a
 * car's own VIN barcode works too); elsewhere, such as an iPhone, jsQR reads QR
 * codes. Both libraries load only when a screen needs them.
 */

/** An SVG drawing of a QR code, ready to put in a printed page. */
export async function qrSvg(text: string, margin = 2): Promise<string> {
  const QRCode = (await import("qrcode")).default;
  return QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin });
}

interface NativeBarcodeDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
interface NativeBarcodeDetectorClass {
  new (options?: { formats?: string[] }): NativeBarcodeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

const WANTED_FORMATS = ["qr_code", "code_39", "code_128", "data_matrix"];

export interface FrameReader {
  /** True when the phone's own reader is used (it also reads VIN barcodes). */
  native: boolean;
  /** The code seen in the current video frame, or null. */
  read(video: HTMLVideoElement): Promise<string | null>;
}

/** Reads a QR code from RGBA pixels (a canvas' ImageData), or null. Exported for tests. */
export async function readQrPixels(data: Uint8ClampedArray, width: number, height: number): Promise<string | null> {
  const jsQR = (await import("jsqr")).default;
  return jsQR(data, width, height, { inversionAttempts: "attemptBoth" })?.data ?? null;
}

/** The best reader this browser offers. */
export async function createFrameReader(): Promise<FrameReader> {
  const Native = (globalThis as { BarcodeDetector?: NativeBarcodeDetectorClass }).BarcodeDetector;
  if (Native) {
    try {
      const supported = (await Native.getSupportedFormats?.()) ?? WANTED_FORMATS;
      const formats = WANTED_FORMATS.filter((f) => supported.includes(f));
      if (formats.includes("qr_code")) {
        const detector = new Native({ formats });
        return {
          native: true,
          read: async (video) => (await detector.detect(video))[0]?.rawValue ?? null,
        };
      }
    } catch {
      // fall back to jsQR below
    }
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return {
    native: false,
    read: async (video) => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!ctx || !w || !h) return null;
      // A smaller frame reads faster and a QR code at arm's length stays readable.
      const scale = Math.min(1, 960 / Math.max(w, h));
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return readQrPixels(frame.data, frame.width, frame.height);
    },
  };
}
