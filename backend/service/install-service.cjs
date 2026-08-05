const path = require("path");
const { Service } = require("node-windows");

const backendDir = path.resolve(__dirname, "..");
const scriptPath = path.join(backendDir, "src", "index.js");

const service = new Service({
  name: "Prestige Systems HUB",
  description: "Prestige Systems HUB backend and web application service.",
  script: scriptPath,
  workingDirectory: backendDir,
  nodeOptions: ["--enable-source-maps"],
  env: [
    { name: "NODE_ENV", value: "production" }
  ]
});

service.on("install", () => {
  console.log("Service installed. Starting...");
  service.start();
});

service.on("alreadyinstalled", () => {
  console.log("Service is already installed.");
});

service.on("start", () => {
  console.log("Service started.");
});

service.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

service.install();
