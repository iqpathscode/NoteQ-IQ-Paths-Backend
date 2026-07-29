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
    const roleId = Number(req.user.active_role_id);

    if (!roleId) {
      return res.status(400).json({ success: false, message: "No active role set for this employee" });
    }

    const notifications = await Notification.find({ emp_id: empId, role_id: roleId })
      .sort({ createdAt: -1 })
      .limit(5);

    res.json(notifications);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;