// import express from 'express';
// import Notification from '../models/notification/notification.js'; // apna actual path confirm kar lena

// const router = express.Router();

// const MAX_NOTIFICATIONS = 5; // yahan se count control hoga

// router.get('/', async (req, res) => {
//   try {
//     const notifications = await Notification.find({ emp_id: req.user.emp_id })
//       .sort({ createdAt: -1 })
//       .limit(MAX_NOTIFICATIONS);
//     res.json(notifications);
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// });

// export default router;


import express from 'express';
import Notification from '../models/notification/notification.js';

const router = express.Router();

const MAX_NOTIFICATIONS = 5;

router.get('/', async (req, res) => {
  try {
    const empId = Number(req.user.emp_id);
    const roleId = req.user.active_role_id ? Number(req.user.active_role_id) : null;

    // 🔄 role_id ke exact match ke bajaye — emp match + (role match YA role_id null wali notifications)
    const query = roleId
      ? { emp_id: empId, $or: [{ role_id: roleId }, { role_id: null }] }
      : { emp_id: empId, role_id: null };   // role-less user ko sirf role-agnostic wali milengi

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(MAX_NOTIFICATIONS);

    res.json(notifications);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Mark all notifications as read for current user
router.put('/mark-read', async (req, res) => {
  try {
    const empId = Number(req.user.emp_id);
    const roleId = req.user.active_role_id ? Number(req.user.active_role_id) : null;

    const query = roleId
      ? { emp_id: empId, $or: [{ role_id: roleId }, { role_id: null }] }
      : { emp_id: empId, role_id: null };

    await Notification.updateMany(query, { $set: { is_read: true } });

    res.json({ success: true, message: 'Notifications marked as read' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;