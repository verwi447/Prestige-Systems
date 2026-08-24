import express from "express";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { fileURLToPath } from "url";
import { auth } from "../middleware/auth.js";
import { loadCurrentUser, normalizeRole } from "../middleware/access.js";
import { db } from "../db.js";
import { numberToWords } from "../utils/numberToWords.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { autoAsyncRoutes } from "../utils/autoAsyncRoutes.js";

const router = express.Router();
autoAsyncRoutes(router);

const money = (value, currency = "PLN") =>
  `${Number(value || 0).toLocaleString("pl-PL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} ${currency}`;

const formatDate = (date) => (date ? new Date(date).toLocaleDateString("pl-PL") : "");

const splitNotes = (value) =>
  String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

const daysBetweenInclusive = (startValue, endValue) => {
  if (!startValue || !endValue) return null;
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  const diff = Math.round((end - start) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : null;
};

function registerFonts(doc) {
  const fontDir = path.join(__dirname, "../../assets/fonts");
  const regularPath = path.join(fontDir, "Lato-Regular.ttf");
  const boldPath = path.join(fontDir, "Lato-Bold.ttf");
  const arialRegularPath = "C:\\Windows\\Fonts\\arial.ttf";
  const arialBoldPath = "C:\\Windows\\Fonts\\arialbd.ttf";

  if (fs.existsSync(regularPath) && fs.existsSync(boldPath)) {
    doc.registerFont("Regular", regularPath);
    doc.registerFont("Bold", boldPath);
  } else if (fs.existsSync(arialRegularPath) && fs.existsSync(arialBoldPath)) {
    doc.registerFont("Regular", arialRegularPath);
    doc.registerFont("Bold", arialBoldPath);
  } else {
    doc.registerFont("Regular", "Helvetica");
    doc.registerFont("Bold", "Helvetica-Bold");
  }
}

function text(doc, value, x, y, width, options = {}) {
  doc
    .font(options.bold ? "Bold" : "Regular")
    .fontSize(options.size || 8)
    .fillColor(options.color || "#061a46");
  doc.text(value || "", x, y, { width, align: options.align || "left", lineGap: options.lineGap || 0 });
}

function drawCell(doc, value, x, y, width, height, options = {}) {
  if (options.fill) doc.rect(x, y, width, height).fill(options.fill);
  doc.rect(x, y, width, height).stroke(options.stroke || "#dfe5ee");
  const paddingX = options.paddingX ?? 7;
  const paddingY = options.paddingY ?? 7;
  text(doc, value, x + paddingX, y + paddingY, width - paddingX * 2, {
    bold: options.bold,
    size: options.size || 8,
    align: options.align,
    color: options.color || "#061a46"
  });
}

function getOwnCompanyLogoPath(logoUrl) {
  const prefix = "/uploads/company/";
  if (typeof logoUrl !== "string" || !logoUrl.startsWith(prefix)) return "";

  const filename = logoUrl.slice(prefix.length);
  if (!filename || path.basename(filename) !== filename) return "";

  const extension = path.extname(filename).toLowerCase();
  if (![".png", ".jpg", ".jpeg"].includes(extension)) return "";

  const logoPath = path.join(__dirname, "../../uploads/company", filename);
  return fs.existsSync(logoPath) ? logoPath : "";
}

export async function loadOfferPdfData(offerId, { isClient = false, companyId = null } = {}) {
  const params = [offerId];
  let accessSql = "WHERE o.id=$1";
  if (isClient) {
    params.push(companyId);
    accessSql += " AND c.company_id=$2 AND UPPER(COALESCE(o.status, '')) <> ALL(ARRAY['SZKIC','DRAFT']::text[])";
  }
  const offerRes = await db.query(
    `SELECT
      o.*,
      c.name as customer_name,
      c.address as customer_address,
      c.email as customer_email,
      c.phone as customer_phone,
      c.nip as customer_nip,
      co.name as company_name,
      u.username as creator_name,
      u.first_name as creator_first_name,
      u.last_name as creator_last_name,
      u.email as creator_email,
      u.phone as creator_phone
     FROM offers o
     LEFT JOIN customers c ON o.customer_id = c.id
     LEFT JOIN companies co ON c.company_id = co.id
     LEFT JOIN users u ON o.created_by = u.id
     ${accessSql}`,
    params
  );

  if (!offerRes.rows[0]) return null;
  const offer = offerRes.rows[0];

  const itemsRes = await db.query("SELECT * FROM offer_items WHERE offer_id=$1 ORDER BY item_number ASC", [offerId]);
  const items = itemsRes.rows;
  const ownCompanyRes = await db.query("SELECT * FROM own_company ORDER BY id ASC LIMIT 1");
  let ownCompany = ownCompanyRes.rows[0] || null;
  if (!ownCompany) {
    const legacyOwnCompanyRes = await db.query("SELECT * FROM companies WHERE is_own_company = TRUE ORDER BY id ASC LIMIT 1");
    ownCompany = legacyOwnCompanyRes.rows[0] || null;
  }

  return { offer, items, ownCompany };
}

export async function renderOfferPdfBuffer({ offer, items, ownCompany }) {
  {
    const currency = offer.currency || "PLN";
    const totalNet = items.reduce((sum, item) => sum + Number(item.net_total ?? item.total ?? 0), 0);

    const doc = new PDFDocument({ size: "A4", layout: "portrait", margin: 0 });
    registerFonts(doc);
    const pdfChunks = [];
    const pdfFinished = new Promise((resolve, reject) => {
      doc.on("data", (chunk) => pdfChunks.push(chunk));
      doc.on("end", resolve);
      doc.on("error", reject);
    });

    const fileName = `oferta_${String(offer.offer_number || offer.id).replace(/\//g, "_")}.pdf`;
    const left = 42;
    const right = 553;
    const pageWidth = right - left;
    const logoPath = path.join(__dirname, "../../assets/offer-logo-light.png");
    const issuePlace = ownCompany?.city || offer.client_city || "Warszawa";
    const creatorFullName = [offer.creator_first_name, offer.creator_last_name].filter(Boolean).join(" ");
    const preparedName = creatorFullName || offer.creator_name || offer.prepared_by_name || offer.salesperson || "";
    const preparedPhone = offer.creator_phone || offer.prepared_by_phone || "";
    const preparedEmail = offer.creator_email || offer.prepared_by_email || "";
    const clientName = offer.client_company_name || offer.company_name || offer.customer_name || "";
    const contactName = offer.client_contact_person || offer.customer_name || "";
    const clientAddress = offer.client_address || offer.customer_address || "";
    const clientEmail = offer.client_email || offer.customer_email || "";
    const clientPhone = offer.client_phone || offer.customer_phone || "";
    const clientNip = offer.client_nip || offer.customer_nip || "";
    const validityDays = daysBetweenInclusive(offer.issue_date || offer.created_at, offer.valid_until);
    const validityText = offer.validity_days ? `${offer.validity_days} dni` : validityDays ? `${validityDays} dni` : offer.valid_until ? `do ${formatDate(offer.valid_until)}` : "-";
    const customNotes = [...splitNotes(offer.remarks), ...splitNotes(offer.additional_info)].filter(
      (note) =>
        !/^forma płatności:/i.test(note)
        && !/^termin realizacji:/i.test(note)
        && !/^ważność oferty:/i.test(note)
        && !/^do wartości oferty zostanie naliczony podatek vat\.?$/i.test(note)
    );

    doc.rect(0, 0, doc.page.width, doc.page.height).fill("#ffffff");

    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, left, 22, { width: 190 });
    }
    text(doc, [issuePlace, formatDate(offer.issue_date)].filter(Boolean).join(", "), 375, 34, 178, {
      size: 10,
      bold: true,
      align: "right"
    });

    text(doc, "OFERTA HANDLOWA", left, 88, pageWidth, { size: 28, bold: true });
    text(doc, offer.title || "Nazwa oferty", left, 122, pageWidth, { size: 15, color: "#7b8498" });

    doc.rect(left + 2, 164, 10, 13).strokeColor("#061a46").lineWidth(1).stroke();
    doc.moveTo(left + 5, 168).lineTo(left + 10, 168).strokeColor("#061a46").stroke();
    doc.moveTo(left + 5, 172).lineTo(left + 10, 172).strokeColor("#061a46").stroke();
    text(doc, "Numer oferty", left + 32, 164, 130, { size: 9 });
    text(doc, offer.offer_number || "Numer zostanie nadany", left + 32, 181, 180, { size: 13, bold: true });
    doc.moveTo(left, 211).lineTo(right, 211).lineWidth(1).strokeColor("#cfd8e6").stroke();

    text(doc, "OFERTA DLA:", left, 230, 130, { size: 9.5, bold: true });
    text(doc, clientName, left, 252, 215, { size: 14, bold: true });
    if (contactName) text(doc, contactName, left, 277, 215, { size: 10.5, bold: true });
    if (clientAddress) text(doc, clientAddress, left, 294, 215, { size: 9 });

    doc.moveTo(248, 238).lineTo(248, 310).lineWidth(1).strokeColor("#cfd8e6").stroke();
    let contactY = 246;
    [
      ["e-mail:", clientEmail],
      ["tel.:", clientPhone],
      ["NIP:", clientNip]
    ].forEach(([label, value]) => {
      if (!value) return;
      text(doc, label, 272, contactY, 54, { size: 9, bold: true });
      text(doc, value, 326, contactY, 190, { size: 9.5 });
      contactY += 23;
    });

    let y = 326;
    text(doc, "POZYCJE OFERTY", left, y, 180, { size: 9.5, bold: true });
    y += 18;

    const columns = [
      { label: "LP", width: 28, align: "center" },
      { label: "Numer artykułu", width: 82, align: "left" },
      { label: "Opis", width: 210, align: "left" },
      { label: `Cena w ${currency}`, width: 72, align: "right" },
      { label: "Ilość", width: 58, align: "center" },
      { label: "Wartość netto", width: 61, align: "right" }
    ];
    const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);

    let x = left;
    columns.forEach((column) => {
      drawCell(doc, column.label, x, y, column.width, 24, {
        size: 8.2,
        bold: true,
        align: "center",
        fill: "#061a46",
        stroke: "#dfe5ee",
        color: "#ffffff",
        paddingY: 7
      });
      x += column.width;
    });
    y += 24;

    items.forEach((item, index) => {
      const itemName = item.title || item.name || "";
      const rowHeight = Math.max(32, doc.heightOfString(itemName, { width: columns[2].width - 14 }) + 15);
      if (y + rowHeight > 655) {
        doc.addPage({ size: "A4", layout: "portrait", margin: 0 });
        doc.rect(0, 0, doc.page.width, doc.page.height).fill("#ffffff");
        y = 50;
      }

      x = left;
      const row = [
        String(index + 1),
        item.code || item.sku || "",
        itemName,
        money(item.unit_price, currency).replace(` ${currency}`, ""),
        String(Number(item.quantity || 0).toLocaleString("pl-PL")),
        money(item.net_total ?? item.total ?? 0, currency).replace(` ${currency}`, "")
      ];
      row.forEach((value, cellIndex) => {
        drawCell(doc, value, x, y, columns[cellIndex].width, rowHeight, {
          size: 8,
          bold: cellIndex === 2,
          align: columns[cellIndex].align,
          fill: "#ffffff",
          stroke: "#dfe5ee",
          color: "#061a46",
          paddingX: 8,
          paddingY: 7
        });
        x += columns[cellIndex].width;
      });
      y += rowHeight;
    });

    if (!items.length) {
      drawCell(doc, "Brak pozycji w ofercie", left, y, tableWidth, 34, {
        size: 8.5,
        align: "center",
        fill: "#ffffff",
        stroke: "#dfe5ee",
        color: "#7b8498",
        paddingY: 10
      });
      y += 34;
    }

    const tailRequiredHeight = 204 + Math.min(customNotes.length, 4) * 14;
    if (y + tailRequiredHeight > 744) {
      doc.addPage({ size: "A4", layout: "portrait", margin: 0 });
      doc.rect(0, 0, doc.page.width, doc.page.height).fill("#ffffff");
      y = 46;
    }

    y += 8;
    doc.rect(left, y, tableWidth, 30).fill("#089333");
    text(doc, "WARTOŚĆ OFERTY NETTO", left + 220, y + 9, 170, { size: 10, bold: true, color: "#ffffff", align: "right" });
    text(doc, money(totalNet, currency), left + 397, y + 7, 104, { size: 14, bold: true, color: "#ffffff", align: "right" });
    y += 38;

    text(doc, `Słownie: ${numberToWords(totalNet, currency)}`, left + 165, y, 346, { size: 9, align: "right" });

    y += 24;
    text(doc, "WARUNKI OFERTY", left, y, 180, { size: 9.5, bold: true });
    y += 15;
    [
      ["Forma płatności:", offer.payment_terms || "-"],
      ["Termin realizacji:", offer.realization_time || "Do ustalenia"],
      ["Ważność oferty:", validityText]
    ].forEach(([label, value]) => {
      drawCell(doc, label, left, y, 110, 20, { size: 8.2, bold: true, stroke: "#dfe5ee", paddingY: 6 });
      drawCell(doc, value, left + 110, y, pageWidth - 110, 20, { size: 8.2, stroke: "#dfe5ee", paddingY: 6 });
      y += 20;
    });
    drawCell(doc, "Do wartości oferty zostanie naliczony podatek VAT.", left, y, pageWidth, 20, { size: 8.2, stroke: "#dfe5ee", paddingY: 6 });
    y += 24;

    customNotes.forEach((note) => {
      if (y + 14 > 744) return;
      text(doc, note, left, y, pageWidth, { size: 8.2 });
      y += 14;
    });

    doc.moveTo(left, 758).lineTo(right, 758).lineWidth(1).strokeColor("#cfd8e6").stroke();
    const ownCompanyLogoPath = getOwnCompanyLogoPath(ownCompany?.logo_url);
    let footerCompanyX = left;
    let footerCompanyWidth = 245;
    if (ownCompanyLogoPath) {
      try {
        doc.image(ownCompanyLogoPath, left, 771, { fit: [64, 38] });
        footerCompanyX += 76;
        footerCompanyWidth -= 76;
      } catch (_error) {
        // The text footer remains available when the uploaded image cannot be embedded in PDF.
      }
    }

    const ownLines = [
      ownCompany?.name || "",
      ownCompany?.nip ? `NIP: ${ownCompany.nip}` : "",
      [ownCompany?.address, ownCompany?.postal_code, ownCompany?.city].filter(Boolean).join(" "),
      [ownCompany?.phone ? `tel.: ${ownCompany.phone}` : "", ownCompany?.email || ""].filter(Boolean).join(" | ")
    ].filter(Boolean);

    let footerY = 770;
    ownLines.forEach((line, index) => {
      text(doc, line, footerCompanyX, footerY, footerCompanyWidth, { size: index === 0 ? 8.8 : 7.7, bold: index === 0 });
      footerY += 12;
    });

    const preparedBlockWidth = 210;
    const preparedBlockX = right - preparedBlockWidth;
    text(doc, "Ofertę przygotował", preparedBlockX, 776, preparedBlockWidth, { size: 8.2, align: "right" });
    text(doc, preparedName || "...", preparedBlockX, 793, preparedBlockWidth, { size: 9, bold: true, align: "right" });
    text(doc, preparedPhone ? `tel.: ${preparedPhone}` : "tel.: ...", preparedBlockX, 809, preparedBlockWidth, { size: 8.2, align: "right" });
    text(doc, preparedEmail ? `e-mail: ${preparedEmail}` : "e-mail: ...", preparedBlockX, 825, preparedBlockWidth, { size: 8.2, align: "right" });

    doc.end();
    await pdfFinished;
    const pdfBuffer = Buffer.concat(pdfChunks);
    return { buffer: pdfBuffer, fileName };
  }
}

router.get("/:offer_id", auth, loadCurrentUser, async (req, res) => {
  try {
    const role = normalizeRole(req.currentUser?.role);
    const isClient = ["CLIENT_OWNER", "CLIENT_EMPLOYEE"].includes(role);
    const data = await loadOfferPdfData(req.params.offer_id, { isClient, companyId: req.currentUser?.company_id });
    if (!data) return res.status(404).json({ error: "Oferta nie znaleziona" });

    const { buffer, fileName } = await renderOfferPdfBuffer(data);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
});

// Used by offers.js to attach the offer PDF to outgoing emails without an
// internal HTTP round-trip (which previously always 401'd - auth only reads
// the session cookie, and a server-to-server fetch() carries none).
export async function generateOfferPdfInternal(offerId) {
  const data = await loadOfferPdfData(offerId);
  if (!data) return null;
  return renderOfferPdfBuffer(data);
}

export default router;
