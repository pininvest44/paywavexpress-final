const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Global In-Memory State for Logs & Current Queue Status
let taskQueue = [];
let isProcessing = false;
let executionLogs = [];

// Helper utility to format phone numbers to "07..." or "2547..." format securely
const cleanPhoneNumber = (phone) => {
  let cleaned = phone.replace(/\D/g, ''); // Strip non-numeric chars
  if (cleaned.startsWith('0')) {
    return cleaned; // Keeps '07...' standard
  } else if (cleaned.startsWith('254') && cleaned.length === 12) {
    return '0' + cleaned.slice(3); // normalizes 2547... to 07...
  }
  return cleaned;
};

// Queue Processing Loop (Exactly 17 requests per minute -> ~3.53 seconds per request)
const processQueue = async () => {
  if (isProcessing || taskQueue.length === 0) return;
  isProcessing = true;

  const DELAY_MS = Math.ceil(60000 / 17); // ~3530 milliseconds

  while (taskQueue.length > 0) {
    const task = taskQueue.shift();
    const timestamp = new Date().toLocaleTimeString();

    try {
      const payload = {
        api_key: process.env.PAYWAVE_API_KEY,
        email: process.env.PAYWAVE_EMAIL,
        amount: String(task.amount),
        msisdn: cleanPhoneNumber(task.phone),
        reference: task.reference
      };

      if (task.accountNumber) {
        payload.account_number = task.accountNumber;
      }

      const response = await fetch('https://paywavexpress.co.ke/v1/stkpush', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const responseData = await response.json();

      if (response.ok) {
        executionLogs.unshift({
          time: timestamp,
          phone: task.phone,
          status: 'SUCCESS',
          details: `Prompt Sent! (Ref: ${task.reference})`,
        });
      } else {
        executionLogs.unshift({
          time: timestamp,
          phone: task.phone,
          status: 'FAILED',
          details: responseData.message || 'Rejected by Paywave API',
        });
      }
    } catch (error) {
      executionLogs.unshift({
        time: timestamp,
        phone: task.phone,
        status: 'FAILED',
        details: `Network Error: ${error.message}`,
      });
    }

    // Rate Limit Enforcer (Pause loop for 3.53s)
    if (taskQueue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }

  isProcessing = false;
};

// API Endpoint to submit batch
app.post('/api/bulk-push', (req, res) => {
  const { phones, amount, reference, accountNumber } = req.body;

  if (!phones || !Array.isArray(phones) || phones.length === 0) {
    return res.status(400).json({ error: 'Please provide an array of phone numbers.' });
  }
  if (!amount || isNaN(amount) || Number(amount) < 1) {
    return res.status(400).json({ error: 'Please enter a valid amount (minimum KES 1).' });
  }

  // Generate distinct tasks to add to queue
  const newTasks = phones.map((phone, index) => ({
    phone: phone.trim(),
    amount: amount,
    reference: `${reference}-${Date.now()}-${index}`,
    accountNumber: accountNumber || null,
  }));

  taskQueue.push(...newTasks);
  processQueue(); // Fire non-blocking queue processing

  res.json({ message: `${newTasks.length} jobs added to processing queue.` });
});

// API Endpoint to check execution logs and queue count
app.get('/api/status', (req, res) => {
  res.json({
    queueLength: taskQueue.length,
    isProcessing,
    logs: executionLogs,
  });
});

// API Endpoint to reset log dashboard
app.post('/api/reset', (req, res) => {
  executionLogs = [];
  taskQueue = [];
  isProcessing = false;
  res.json({ message: 'Dashboard cleared.' });
});

app.listen(PORT, () => {
  console.log(`Server executing at http://localhost:${PORT}`);
});
