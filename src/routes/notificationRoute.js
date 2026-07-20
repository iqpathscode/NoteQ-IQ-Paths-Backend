import express from 'express';
import Notification from '../models/notification/notification.js'; // apna actual path confirm kar lena

const router = express.Router();

const MAX_NOTIFICATIONS = 5; // yahan se count control hoga

router.get('/', async (req, res) => {
  try {
    const notifications = await Notification.find({ emp_id: req.user.emp_id })
      .sort({ createdAt: -1 })
      .limit(MAX_NOTIFICATIONS);
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;