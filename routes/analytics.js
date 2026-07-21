const express = require('express');
const { protect } = require('../middleware/auth');
const Video = require('../models/Video');

const router = express.Router();

// @route GET /api/analytics
// Note: real "Views / Watch Time / CTR / Subscribers" numbers must come from the
// YouTube Analytics API (youtubeAnalytics.reports.query) using the connected channel's
// access token — plug that call in here once the channel has enough data.
router.get('/', protect, async (req, res) => {
  try {
    const [uploadCount, scheduledQueue, failedUploads] = await Promise.all([
      Video.countDocuments({ user: req.user._id, status: 'uploaded' }),
      Video.countDocuments({ user: req.user._id, status: 'scheduled' }),
      Video.countDocuments({ user: req.user._id, status: 'failed' })
    ]);

    res.json({
      success: true,
      analytics: {
        uploadCount,
        remainingUploadCredits: req.user.diamondBalance,
        freeUploadsLeft: req.user.freeUploadsRemaining,
        scheduledQueue,
        failedUploads
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
