import type { ReportExportConfig } from "../components/ReportExportModal";

export interface PageDimensions {
  widthMm: number;
  heightMm: number;
  orientation: "landscape" | "portrait";
  format: "a4" | "letter";
}

export function formatPdfFilename(projectName?: string): string {
  const sanitized = (projectName || "editmap")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  const base = sanitized || "editmap";
  return `${base}-film-analysis-report.pdf`;
}

export function getPageDimensions(format: ReportExportConfig["format"]): PageDimensions {
  switch (format) {
    case "A4 Portrait":
      return { widthMm: 210, heightMm: 297, orientation: "portrait", format: "a4" };
    case "Letter":
      return { widthMm: 279.4, heightMm: 215.9, orientation: "landscape", format: "letter" };
    case "A4 Landscape":
    default:
      return { widthMm: 297, heightMm: 210, orientation: "landscape", format: "a4" };
  }
}

function getElementRelativeTop(child: HTMLElement, root: HTMLElement): number {
  let top = 0;
  let curr: HTMLElement | null = child;
  while (curr && curr !== root) {
    top += curr.offsetTop;
    curr = curr.offsetParent as HTMLElement | null;
  }
  return top;
}

/**
 * Generates a multi-page PDF document from the report element.
 * Accurately unscales any preview transforms, preserves full colors/SVGs,
 * and breaks across pages without slicing cards in half.
 */
export async function generateReportPdf(
  element: HTMLElement,
  config: ReportExportConfig,
  title?: string
): Promise<Blob> {
  const dims = getPageDimensions(config.format);
  const bgColor = config.theme === "dark" ? "#0f172a" : "#ffffff";

  // Capture the visible report element at high resolution (scale 2 for crisp vector text/charts)
  // Heavy export libraries load only when a report is actually exported.
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: bgColor,
    onclone: (clonedDoc) => {
      // Unconstrain any scroll parent containers so full height is captured
      const scrollParents = clonedDoc.querySelectorAll(".preview-scroll-container");
      scrollParents.forEach((sp) => {
        const el = sp as HTMLElement;
        el.style.overflow = "visible";
        el.style.height = "auto";
        el.style.maxHeight = "none";
      });

      // Remove scaling transforms so clone renders at 1:1 true paper dimensions
      const wrappers = clonedDoc.querySelectorAll(".preview-page-wrapper");
      wrappers.forEach((w) => {
        const el = w as HTMLElement;
        el.style.transform = "none";
        el.style.boxShadow = "none";
        el.style.margin = "0";
        el.style.padding = "0";
      });

      // Ensure report root is fully visible
      const roots = clonedDoc.querySelectorAll(".printable-report-root");
      roots.forEach((r) => {
        const el = r as HTMLElement;
        el.style.opacity = "1";
        el.style.visibility = "visible";
        el.style.transform = "none";
      });
    },
  });

  const doc = new jsPDF({
    orientation: dims.orientation,
    unit: "mm",
    format: dims.format,
    compress: true,
  });

  if (title) {
    doc.setProperties({
      title: `${title} - Film Analysis Report`,
      subject: "EDITMAP Rhythm & Narrative Architecture Report",
      creator: "EDITMAP",
    });
  }

  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;
  const pageAspect = dims.heightMm / dims.widthMm;
  const nominalPageHeightPx = Math.floor(canvasWidth * pageAspect);

  // Identify safe break points using DOM offset metrics (immune to CSS transforms)
  const cardElements = Array.from(element.querySelectorAll(".report-card, .report-header"));
  const scaleRatio = canvasWidth / (element.offsetWidth || 1);

  const breakPoints: number[] = [];
  cardElements.forEach((card) => {
    const cardEl = card as HTMLElement;
    const topPx = getElementRelativeTop(cardEl, element) * scaleRatio;
    const bottomPx = topPx + cardEl.offsetHeight * scaleRatio;
    if (topPx > 10) {
      breakPoints.push(Math.round(topPx));
    }
    if (bottomPx > 10 && bottomPx < canvasHeight - 10) {
      breakPoints.push(Math.round(bottomPx));
    }
  });

  let currentY = 0;
  let pageIndex = 0;

  while (currentY < canvasHeight) {
    const remainingHeight = canvasHeight - currentY;
    let sliceHeightPx = Math.min(nominalPageHeightPx, remainingHeight);

    // If not the last page, break cleanly before a card boundary if available
    if (currentY + sliceHeightPx < canvasHeight) {
      const targetCut = currentY + nominalPageHeightPx;
      const minAcceptableCut = currentY + nominalPageHeightPx * 0.55;

      const candidateBreaks = breakPoints.filter(
        (bp) => bp > minAcceptableCut && bp <= targetCut
      );

      if (candidateBreaks.length > 0) {
        sliceHeightPx = Math.max(...candidateBreaks) - currentY;
      }
    }

    // Render this slice onto an off-screen canvas
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvasWidth;
    pageCanvas.height = sliceHeightPx;
    const pageCtx = pageCanvas.getContext("2d");

    if (pageCtx) {
      pageCtx.fillStyle = bgColor;
      pageCtx.fillRect(0, 0, canvasWidth, sliceHeightPx);
      pageCtx.drawImage(
        canvas,
        0,
        currentY,
        canvasWidth,
        sliceHeightPx,
        0,
        0,
        canvasWidth,
        sliceHeightPx
      );
    }

    const pageImgData = pageCanvas.toDataURL("image/jpeg", 0.95);
    const renderedHeightMm = (sliceHeightPx / canvasWidth) * dims.widthMm;

    if (pageIndex > 0) {
      doc.addPage(dims.format, dims.orientation);
    }

    doc.addImage(pageImgData, "JPEG", 0, 0, dims.widthMm, renderedHeightMm, undefined, "FAST");

    currentY += sliceHeightPx;
    pageIndex++;
  }

  return doc.output("blob");
}

/**
 * Saves a PDF Blob to disk by opening the native OS Save File Picker (if supported),
 * or falling back to a direct browser download.
 * Returns true if saved, false if cancelled by user.
 */
export async function savePdfWithFilePicker(
  pdfBlob: Blob,
  filename: string
): Promise<boolean> {
  const safeName = filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`;

  // Try File System Access API (window.showSaveFilePicker)
  if ("showSaveFilePicker" in window && typeof (window as any).showSaveFilePicker === "function") {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: safeName,
        types: [
          {
            description: "PDF Document (*.pdf)",
            accept: { "application/pdf": [".pdf"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(pdfBlob);
      await writable.close();
      return true;
    } catch (err: any) {
      if (err.name === "AbortError") {
        return false;
      }
      console.warn("showSaveFilePicker was rejected or failed, falling back to download:", err);
    }
  }

  // Fallback: standard anchor download
  const blobUrl = URL.createObjectURL(pdfBlob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = safeName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  return true;
}

/**
 * Opens the generated PDF Blob directly in a browser tab for preview.
 * Accepts an optional pre-opened window reference to bypass Safari's popup blocker.
 */
export function openPdfPreview(pdfBlob: Blob, targetWindow?: Window | null): void {
  const blobUrl = URL.createObjectURL(pdfBlob);
  if (targetWindow && !targetWindow.closed) {
    targetWindow.location.href = blobUrl;
  } else {
    const win = window.open(blobUrl, "_blank");
    if (!win) {
      const a = document.createElement("a");
      a.href = blobUrl;
      a.target = "_blank";
      a.click();
    }
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
}
