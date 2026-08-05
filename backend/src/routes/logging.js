import express from "express";
import { logError } from "../logger.js";

const router = express.Router();

// POST log a web error
router.post("/web-error", (req, res) => {
    const { message, stack, context, url, timestamp } = req.body;
    
    let errorToLog = `WEB APP ERROR\nURL: ${url}\nTimestamp: ${timestamp}\nContext: ${context}\nMessage: ${message}\n`;
    if (stack) {
        errorToLog += `Stack: ${stack}\n`;
    }

    logError(errorToLog, 'web');
    
    res.status(204).send();
});

export default router;