import Notesheet from "../models/notes/notesheet.model.js";
import { Counter } from "../models/counter/counter.model.js";
import Employee from "../models/user/employee.model.js";
import Department from "../models/office/department.model.js";
import Role from "../models/userPowers/role.model.js";
import NotesheetFlow from "../models/notes/notesheetFlow.model.js";

export const createNotesheet = async (req, res) => {
  try {
    const {
      emp_id,
      dept_id,
      subject,
      description,
      forward_to_role,
      attachment,
      mode,
    } = req.body;

    console.log("Payload received:", req.body);

    if (!emp_id) return res.status(400).json({ success: false, message: "emp_id is required" });
    if (!dept_id) return res.status(400).json({ success: false, message: "dept_id is required" });
    if (!subject?.trim()) return res.status(400).json({ success: false, message: "Subject is required" });
    if (!description?.trim()) return res.status(400).json({ success: false, message: "Description is required" });

    const sender = await Employee.findOne({ emp_id });
    if (!sender) return res.status(404).json({ success: false, message: "Sender employee not found" });

    const department = await Department.findOne({ dept_id });
    if (!department) return res.status(404).json({ success: false, message: "Department not found" });

    let computedLevel = 1;
    const modeNum = Number(mode);

    if (modeNum === 1) {
      if (!forward_to_role) {
        return res.status(400).json({ success: false, message: "forward_to_role is required in direct mode" });
      }

      console.log("Forward to role:", forward_to_role);

      const role = await Role.findOne({ role_id: Number(forward_to_role) });
      if (!role) {
        return res.status(404).json({ success: false, message: "Target role not found" });
      }

      computedLevel = role.power_level;
    }

    const counter = await Counter.findOneAndUpdate(
      { name: "note_id" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    const notesheet = await Notesheet.create({
      note_id: counter.seq,
      emp_id,
      dept_id,
      subject,
      description,
      forward_to_role: modeNum === 1 ? Number(forward_to_role) : null,
      attachment: attachment ?? null,
      mode: modeNum,
      level: computedLevel,
      status: "PENDING",
    });

    //  Initial flow entry insert karo 
    await NotesheetFlow.create({ 
    note_id: notesheet.note_id,
    from_emp_id: emp_id,
    to_emp_id: notesheet.forward_to ?? null,
    action: "CREATED", 
    remark: null,
    level: notesheet.level 
  });

    return res.status(201).json({
      success: true,
      message: "Notesheet created successfully",
      data: notesheet,
    });

  } catch (error) {
    console.error("Error creating notesheet:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};


export const forwardNotesheet = async (req, res) => {
  try {
    const { note_id, from_emp_id, to_emp_id, remark } = req.body;

    // Find current notesheet
    const notesheet = await Notesheet.findOne({ note_id });
    if (!notesheet) {
      return res.status(404).json({ success: false, message: "Notesheet not found" });
    }

    // Increment level
    const nextLevel = notesheet.level + 1;

    // Update notesheet
    notesheet.level = nextLevel;
    notesheet.forward_to = to_emp_id;
    await notesheet.save();

    // Insert flow entry
    await NotesheetFlow.create({
      note_id,
      from_emp_id,
      to_emp_id,
      action: "FORWARDED",
      remark,
      level: nextLevel
    });

    return res.status(200).json({
      success: true,
      message: "Notesheet forwarded successfully"
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};
