// controllers/notesheet.controller.js
import Notesheet from "../models/notes/notesheet.model.js";
import {Counter} from "../models/counter/counter.model.js";
import Employee from "../models/user/employee.model.js";
import Department from "../models/office/department.model.js";

export const createNotesheet = async (req, res) => {
  try {
    const {
      emp_id,
      dept_id,
      subject,
      description,
      forward_to,
      attachment,
      mode,
    } = req.body;

    /* -------------------- 1. Basic validation -------------------- */

    if (!emp_id) {
      return res.status(400).json({
        success: false,
        message: "emp_id is required",
      });
    }

    if (!dept_id) {
      return res.status(400).json({
        success: false,
        message: "dept_id is required",
      });
    }

    if (!forward_to) {
      return res.status(400).json({
        success: false,
        message: "forward_to (employee id) is required",
      });
    }

    if (!subject || subject.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Subject is required",
      });
    }

    if (!description || description.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Description is required",
      });
    }

    /* -------------------- 2. Validate references -------------------- */

    const sender = await Employee.findOne({ emp_id });
    if (!sender) {
      return res.status(404).json({
        success: false,
        message: "Sender employee not found",
      });
    }

    const receiver = await Employee.findOne({ emp_id: forward_to });
    if (!receiver) {
      return res.status(404).json({
        success: false,
        message: "Forward_to employee not found",
      });
    }

    const department = await Department.findOne({ dept_id });
    if (!department) {
      return res.status(404).json({
        success: false,
        message: "Department not found",
      });
    }

    /* -------------------- 3. Compute initial level -------------------- */

    let computedLevel = 1; // channel-based default

    if (mode === 1) {
      // DIRECT MODE → jump to receiver's power level
      if (receiver.power_level === undefined) {
        return res.status(500).json({
          success: false,
          message: "Receiver power level not configured",
        });
      }
      computedLevel = receiver.power_level;
    }

    /* -------------------- 4. Generate note_id -------------------- */

    const counter = await Counter.findOneAndUpdate(
      { name: "note_id" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    /* -------------------- 5. Create notesheet -------------------- */

    const notesheet = await Notesheet.create({
      note_id: counter.seq,
      emp_id,
      dept_id,
      subject,
      description,
      forward_to,
      attachment: attachment ?? null,
      mode: mode ?? 0,
      level: computedLevel,
      // status defaults to PENDING
    });

    return res.status(201).json({
      success: true,
      message: "Notesheet created successfully",
      data: notesheet,
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
