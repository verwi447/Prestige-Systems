import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve the project root, which is two directories up from `backend/src`
const projectRoot = path.resolve(__dirname, '..', '..');
const logsDir = path.join(projectRoot, 'logs');

// Ensure logs directory exists
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

const getLogFilePath = (logType) => {
    const subDir = path.join(logsDir, logType);
    if (!fs.existsSync(subDir)) {
        fs.mkdirSync(subDir, { recursive: true });
    }
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(subDir, `${date}.log`);
};

export const logError = (error, logType = 'backend') => {
    const filePath = getLogFilePath(logType);
    const timestamp = new Date().toISOString();
    
    let logMessage = `[${timestamp}] - ERROR\n`;
    
    if (error instanceof Error) {
        logMessage += `Message: ${error.message}\nStack: ${error.stack}\n`;
    } else {
        logMessage += `Data: ${typeof error === 'object' ? JSON.stringify(error, null, 2) : error}\n`;
    }
    
    logMessage += '--------------------------------------------------\n\n';

    fs.appendFile(filePath, logMessage, (err) => {
        if (err) {
            console.error('Failed to write to log file:', err);
        }
    });
};