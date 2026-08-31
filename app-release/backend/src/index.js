import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import http from "http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { fileURLToPath } from "url";

import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import offerRoutes from "./routes/offers.js";
import customerRoutes from "./routes/customers.js";
import companyRoutes from "./routes/companies.js";
import objectRoutes from "./routes/objects.js";
import productRoutes from "./routes/products.js";
import templateRoutes from "./routes/templates.js";
import dashboardRoutes from "./routes/dashboard.js";
import clientRoutes from "./routes/client.js";
import accountRoutes from "./routes/account.js";
import ticketRoutes from "./routes/tickets.js";
import commentRoutes from "./routes/comments.js";
import rejectionRoutes from "./routes/rejections.js";
import photoRoutes from "./routes/photos.js";
import adminRoutes from "./routes/admin.js";
import adminsRoutes from "./routes/admins.js";
import ownCompanyRoutes from "./routes/ownCompany.js";
import uploadRoutes from "./routes/uploads.js";
import pdfRoutes from "./routes/pdf.js";
import backupRoutes from "./routes/backups.js";
import notificationRoutes from "./routes/notifications.js";
import emailRoutes from "./routes/email.js";
import adminOrderRoutes from "./routes/adminOrders.js";
import fileRoutes from "./routes/files.js";
import systemRoutes from "./routes/system.js";
import auditRoutes from "./routes/audit.js";
import searchRoutes from "./routes/search.js";
import aiAssistantRoutes from "./routes/aiAssistant.js";
import { migrate } from "./migrate.js";
import { setRealtimeServer } from "./realtime.js";
import { db } from "./db.js";
import { apiLimiter, loginLimiter, notFoundApi, requestGuard, safeErrorHandler } from "./middleware/security.js";

// Express 4 does not route rejections thrown inside async route handlers to
// safeErrorHandler; left unhandled, Node terminates the whole process on the
// next tick. This is the last-resort net for any handler that slips through.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appVersionPath = path.resolve(__dirname, "../../app-version.json");

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 5000);
const NODE_ENV = String(process.env.NODE_ENV || "development").toLowerCase();
const HOST = process.env.HOST || (NODE_ENV === "production" ? "127.0.0.1" : null);
const isHttpsPublicUrl = String(process.env.PUBLIC_BASE_URL || "").trim().toLowerCase().startsWith("https://");
const trustProxy = String(process.env.TRUST_PROXY || (HOST === "127.0.0.1" ? "loopback" : "false")).toLowerCase();
const allowedOrigins = new Set(
  String(process.env.ALLOWED_ORIGINS || `http://localhost:${PORT},http://127.0.0.1:${PORT},http://localhost:5173,http://127.0.0.1:5173`)
    .split(",").map((origin) => origin.trim()).filter(Boolean)
);
const corsOptions = {
  credentials: true,
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    const error = new Error("Origin not allowed");
    error.status = 403;
    return callback(error);
  }
};
const io = new Server(server, {
  cors: corsOptions
});

function parseCookieHeader(header) {
  const result = {};
  if (!header) return result;
  header.split(";").forEach((pair) => {
    const index = pair.indexOf("=");
    if (index === -1) return;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(value);
      } catch {
        result[key] = value;
      }
    }
  });
  return result;
}

io.use(async (socket, next) => {
  try {
    const token = parseCookieHeader(socket.handshake.headers.cookie).token;
    if (!token) return next(new Error("Brak tokenu"));
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"], issuer: "prestige-systems-hub", audience: "prestige-systems-hub-api"
    });
    const result = await db.query("SELECT id, role, company_id, is_active FROM users WHERE id=$1", [decoded.id]);
    const user = result.rows[0];
    if (!user || user.is_active === false) return next(new Error("Błędny token"));
    socket.user = { ...decoded, role: user.role === "USER" ? "CLIENT_EMPLOYEE" : user.role, companyId: user.company_id };
    next();
  } catch {
    next(new Error("Błędny token"));
  }
});

io.on("connection", (socket) => {
  if (socket.user?.id) socket.join(`user:${socket.user.id}`);
});

setRealtimeServer(io);

app.disable("x-powered-by");
app.set("trust proxy", trustProxy === "loopback" ? "loopback" : false);
app.use(helmet({
  crossOriginResourcePolicy: { policy: "same-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      // HTTP LAN access must not upgrade module requests to unavailable HTTPS.
      upgradeInsecureRequests: isHttpsPublicUrl ? [] : null
    }
  }
}));
// Helmet has no built-in Permissions-Policy middleware - the app uses none of
// these browser features, so lock them all down.
app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()"
  );
  next();
});
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json({ limit: "2mb", strict: true }));
app.use(express.urlencoded({ limit: "2mb", extended: false, parameterLimit: 500 }));
app.use(requestGuard);
app.use("/auth/login", loginLimiter);
app.use("/api/auth/login", loginLimiter);
app.use("/api", apiLimiter);

app.get("/app-version.json", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(appVersionPath);
});

app.get("/healthz", async (_req, res) => {
  try {
    await db.query("SELECT 1");
    const version = JSON.parse(fs.readFileSync(appVersionPath, "utf8")).version;
    res.setHeader("Cache-Control", "no-store");
    res.json({ status: "ok", version });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});

// Sensitive attachments are only available through authenticated file routes.
app.use("/uploads/tickets", (_req, res) => res.status(404).json({ error: "Plik nie istnieje." }));
app.use("/uploads/knowledge", (_req, res) => res.status(404).json({ error: "Plik nie istnieje." }));
app.get("/uploads/:fileName", async (req, res, next) => {
  try {
    const protectedFile = await db.query("SELECT 1 FROM photos WHERE file_name=$1 LIMIT 1", [req.params.fileName]);
    if (protectedFile.rows.length) return res.status(404).json({ error: "Plik nie istnieje." });
    next();
  } catch (error) {
    next(error);
  }
});
app.use("/uploads", express.static(path.join(__dirname, "../uploads"), {
  dotfiles: "deny",
  index: false,
  fallthrough: true,
  setHeaders(res) {
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
  }
}));

const frontendDistPath = path.resolve(__dirname, "../../frontend/dist");
if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));

  // Browser navigation to a React route must receive the SPA shell. API calls
  // do not request HTML, so they continue to the authenticated route handlers.
  app.get("*", (req, res, next) => {
    const acceptsHtml = String(req.headers.accept || "").includes("text/html");
    if (
      !acceptsHtml ||
      req.path.startsWith("/api/") ||
      req.path.startsWith("/uploads/") ||
      req.path.startsWith("/socket.io/")
    ) {
      return next();
    }
    return res.sendFile(path.join(frontendDistPath, "index.html"));
  });
}

// Routes
app.use([
  "/users", "/offers", "/customers", "/companies", "/objects", "/products", "/templates",
  "/dashboard", "/client", "/tickets", "/comments", "/rejections", "/photos", "/admin",
  "/admins", "/own-company", "/pdf", "/backups", "/notifications", "/email", "/system", "/audit"
], apiLimiter);
app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/offers", offerRoutes);
app.use("/customers", customerRoutes);
app.use("/companies", companyRoutes);
app.use("/objects", objectRoutes);
app.use("/products", productRoutes);
app.use("/templates", templateRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/client/account", accountRoutes);
app.use("/client", clientRoutes);
app.use("/tickets", ticketRoutes);
app.use("/comments", commentRoutes);
app.use("/rejections", rejectionRoutes);
app.use("/photos", photoRoutes);
app.use("/admin", adminRoutes);
app.use("/admins", adminsRoutes);
app.use("/own-company", ownCompanyRoutes);
app.use("/uploads", uploadRoutes);
app.use("/pdf", pdfRoutes);
app.use("/backups", backupRoutes);
app.use("/notifications", notificationRoutes);
app.use("/email", emailRoutes);
app.use("/system", systemRoutes);
app.use("/audit", auditRoutes);

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/offers", offerRoutes);
app.use("/api/admins", adminsRoutes);
app.use("/api/own-company", ownCompanyRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/companies", companyRoutes);
app.use("/api/sites", objectRoutes);
app.use("/api/objects", objectRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/client/account", accountRoutes);
app.use("/api/client", clientRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/backups", backupRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/system", systemRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/admin-orders", adminOrderRoutes);
app.use("/api/files", fileRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/ai-assistant", aiAssistantRoutes);
app.use(notFoundApi);
app.use(safeErrorHandler);

// Initialize database and start server
migrate()
  .then(() => {
    const onListening = () => console.log(`Backend http://${HOST || "localhost"}:${PORT}`);
    if (HOST) server.listen(PORT, HOST, onListening);
    else server.listen(PORT, onListening);
  })
  .catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
