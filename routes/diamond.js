const express = require('express');
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');
const Transaction = require('../models/Transaction');
const PaymentSettings = require('../models/PaymentSettings');
const { uploadBufferToCloudinary, account1 } = require('../utils/cloudinary');

const router = express.Router();

// Fixed packages: 1 Diamond = ₹1, only these 4 sizes are sold
const DIAMOND_PACKAGES = [10, 50, 100, 200];

// @route GET /api/diamonds/packages
router.get('/packages', protect, (req, res) => {
  const packages = DIAMOND_PACKAGES.map((d) => ({ diamonds: d, priceINR: d }));
  res.json({ success: true, packages, currentBalance: req.user.diamondBalance });
});

// @route GET /api/diamonds/payment-settings  (UPI/QR shown to user before paying)
router.get('/payment-settings', protect, async (req, res) => {
  const settings = await PaymentSettings.findOne();
  if (!settings) {
    return res.status(404).json({ success: false, message: 'Payment settings not configured yet' });
  }
  res.json({
    success: true,
    settings: {
      upiId: settings.upiId,
      qrImageUrl: settings.qrImageUrl,
      accountName: settings.accountName,
      merchantName: settings.merchantName
    }
  });
});

// @route POST /api/diamonds/purchase-request
// multipart/form-data: diamondPackage, utrNumber, screenshot(optional)
router.post('/purchase-request', protect, upload.single('screenshot'), async (req, res) => {
  try {
    const diamondPackage = Number(req.body.diamondPackage);
    const { utrNumber } = req.body;

    if (!DIAMOND_PACKAGES.includes(diamondPackage)) {
      return res.status(400).json({ success: false, message: 'Invalid diamond package. Choose 10, 50, 100 or 200.' });
    }
    if (!utrNumber) {
      return res.status(400).json({ success: false, message: 'UTR number is required' });
    }

    let screenshotUrl = '';
    if (req.file) {
      const result = await uploadBufferToCloudinary(account1, req.file.buffer, {
        resource_type: 'image',
        folder: 'tubepilot/payment_screenshots',
        public_id: `${req.user.userId}_${Date.now()}`
      });
      screenshotUrl = result.secure_url;
    }

    const transaction = await Transaction.create({
      user: req.user._id,
      userDisplayId: req.user.userId,
      type: 'diamond_purchase',
      diamondPackage,
      amountINR: diamondPackage, // 1 diamond = ₹1
      utrNumber,
      screenshotUrl,
      status: 'pending'
    });

    res.status(201).json({
      success: true,
      message: 'Payment request submitted. Diamonds will be added after admin approval.',
      transaction
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route GET /api/diamonds/my-requests
router.get('/my-requests', protect, async (req, res) => {
  const transactions = await Transaction.find({ user: req.user._id, type: 'diamond_purchase' }).sort({ createdAt: -1 });
  res.json({ success: true, transactions });
});

module.exports = router;
