const cron = require('node-cron');
const axios = require('axios');
const Video = require('../models/Video');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { refreshAccessToken, uploadVideoToYouTube, setThumbnail } = require('../utils/youtube');
const { getDriveFileStream } = require('../utils/googleDrive');

// Returns a readable stream for the stored video file regardless of which
// storage tier it landed on (Cloudinary 1/2 or Google Drive).
const getVideoStream = async (video) => {
  if (video.storageProvider === 'google_drive') {
    return getDriveFileStream(video.storageFileId);
  }
  // Cloudinary: stream the file straight from its secure URL
  const response = await axios.get(video.storageUrl, { responseType: 'stream' });
  return response.data;
};

const ensureFreshAccessToken = async (user) => {
  const channel = user.youtubeChannel;
  const isExpired = !channel.tokenExpiryDate || Date.now() > channel.tokenExpiryDate - 60000;
  if (!isExpired) return channel.accessToken;

  const credentials = await refreshAccessToken(channel.refreshToken);
  user.youtubeChannel.accessToken = credentials.access_token;
  user.youtubeChannel.tokenExpiryDate = credentials.expiry_date;
  await user.save();
  return credentials.access_token;
};

const processVideo = async (video) => {
  const user = await User.findById(video.user);
  if (!user || !user.youtubeChannel) {
    video.status = 'failed';
    video.failReason = 'No YouTube channel connected';
    await video.save();
    return;
  }

  try {
    video.status = 'processing';
    await video.save();

    const accessToken = await ensureFreshAccessToken(user);
    const fileStream = await getVideoStream(video);

    const result = await uploadVideoToYouTube({
      accessToken,
      refreshToken: user.youtubeChannel.refreshToken,
      fileStream,
      title: video.title,
      description: video.description,
      tags: video.tags,
      categoryId: video.category,
      privacyStatus: 'public',
      madeForKids: video.audience === 'made_for_kids'
    });

    video.status = 'uploaded';
    video.youtubeVideoId = result.id;
    video.youtubeUrl = `https://youtube.com/watch?v=${result.id}`;
    await video.save();

    await Notification.create({
      user: user._id,
      type: 'upload_completed',
      title: 'Upload Completed ✅',
      message: `"${video.title}" is now live on YouTube.`
    });
  } catch (err) {
    console.error(`Upload failed for video ${video._id}:`, err.message);
    video.status = 'failed';
    video.failReason = err.message;
    await video.save();

    await Notification.create({
      user: user._id,
      type: 'upload_failed',
      title: 'Upload Failed ❌',
      message: `"${video.title}" failed to upload: ${err.message}`
    });
  }
};

// Runs every minute: uploads immediately-queued videos + any scheduled video whose time has arrived
const startScheduler = () => {
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const dueVideos = await Video.find({
        $or: [
          { status: 'queued' },
          { status: 'scheduled', scheduledAt: { $lte: now } }
        ]
      }).limit(10);

      for (const video of dueVideos) {
        await processVideo(video);
      }
    } catch (err) {
      console.error('Scheduler tick error:', err.message);
    }
  });

  console.log('⏰ Upload scheduler is running (checks every minute)');
};

// Monthly free-upload reset: runs once a day, resets any user whose reset date has passed
const startFreeUploadReset = () => {
  cron.schedule('0 0 * * *', async () => {
    try {
      const now = new Date();
      const dueUsers = await User.find({ freeUploadsResetAt: { $lte: now } });
      const freeLimit = Number(process.env.FREE_UPLOADS_PER_MONTH || 20);

      for (const user of dueUsers) {
        user.freeUploadsRemaining = freeLimit;
        user.freeUploadsResetAt = new Date(new Date().setMonth(new Date().getMonth() + 1));
        await user.save();

        await Notification.create({
          user: user._id,
          type: 'free_upload_reset',
          title: 'Free Uploads Reset 🎁',
          message: `Your ${freeLimit} free uploads for this month have been refreshed.`
        });
      }
    } catch (err) {
      console.error('Free upload reset error:', err.message);
    }
  });

  console.log('📅 Monthly free-upload reset job is running');
};

module.exports = { startScheduler, startFreeUploadReset };
