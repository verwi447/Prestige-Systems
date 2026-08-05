const path = require("path");
const { Service } = require("node-windows");

const backendDir = path.resolve(__dirname, "..");
const scriptPath = path.join(backendDir, "src", "index.js");

const service = new Service({
  name: "Prestige Systems HUB",
  script: scriptPath,
  workingDirectory: backendDir
});

service.on("uninstall", () => {
  console.log("Service uninstalled.");
});

service.on("alreadyuninstalled", () => {
  console.log("Service is not installed.");
});

service.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

service.uninstall();
