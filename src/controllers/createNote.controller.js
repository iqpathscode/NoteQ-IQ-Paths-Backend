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
      mode
    } = req.body;

    // ------------ VALIDATION ------------
    if (!emp_id)
      return res.status(400).json({ success: false, message: "emp_id is required" });

    if (!dept_id)
      return res.status(400).json({ success: false, message: "dept_id is required" });

    if (!subject?.trim())
      return res.status(400).json({ success: false, message: "Subject is required" });

    if (!description?.trim())
      return res.status(400).json({ success: false, message: "Description is required" });

    const modeNum = Number(mode);

    if (![0, 1].includes(modeNum)) {
      return res.status(400).json({
        success: false,
        message: "Invalid mode"
      });
    }

    // ------------ SENDER ------------
    const sender = await Employee.findOne({ emp_id });

    if (!sender) {
      return res.status(404).json({
        success: false,
        message: "Sender employee not found"
      });
    }

    // ------------ DEPARTMENT ------------
    const department = await Department.findOne({ dept_id });

    if (!department) {
      return res.status(404).json({
        success: false,
        message: "Department not found"
      });
    }

    let forwardToEmpId = null;
    let level = 1;

    // ------------ DIRECT MODE ------------
    if (modeNum === 1) {

      if (!forward_to_role) {
        return res.status(400).json({
          success: false,
          message: "forward_to_role is required in direct mode"
        });
      }

      const role = await Role.findOne({
        role_id: Number(forward_to_role)
      });

      if (!role) {
        return res.status(404).json({
          success: false,
          message: "Target role not found"
        });
      }

      const receiver = await Employee.findOne({
        role_id: Number(forward_to_role)
      });

      if (!receiver) {
        return res.status(404).json({
          success: false,
          message: "No employee found for this role"
        });
      }

      forwardToEmpId = receiver.emp_id;
      level = role.power_level;
    }

    // ------------ COUNTER ------------
    const counter = await Counter.findOneAndUpdate(
      { name: "note_id" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    // ------------ CREATE NOTESHEET ------------
   const notesheet = await Notesheet.create({
  note_id: counter.seq,
  emp_id,
  dept_id,
  subject,
  description,
  forward_to_role_id: Number(forward_to_role),
  forward_to_emp_id: forwardToEmpId,
  attachment,
  mode: modeNum,
  level,
  status: "PENDING"
});

    // ------------ FLOW ENTRY ------------
    await NotesheetFlow.create({
      note_id: notesheet.note_id,
      from_emp_id: emp_id,
      to_emp_id: forwardToEmpId,
      action: "CREATED",
      remark: null,
      level
    });

    return res.status(201).json({
      success: true,
      message: "Notesheet created successfully",
      data: notesheet
    });

  } catch (error) {

    console.error("Create Notesheet Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

export const forwardNotesheet = async (req, res) => {

  try {

    const {
      note_id,
      from_emp_id,
      to_emp_id,
      remark
    } = req.body;

   const notesheet = await Notesheet.find({
  forward_to_emp_id: req.user.emp_id,
  status: "PENDING"
});

    if (!notesheet) {
      return res.status(404).json({
        success: false,
        message: "Notesheet not found"
      });
    }

    const nextLevel = notesheet.level + 1;

    notesheet.level = nextLevel;
    notesheet.forward_to = to_emp_id;

    await notesheet.save();

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

export const getEligibleRoles = async (req, res) => {

  try {

    const roles = await Role.aggregate([
      {
        $lookup: {
          from: "powers",
          localField: "power_id",
          foreignField: "power_id",
          as: "powerInfo"
        }
      },
      { $unwind: "$powerInfo" },
      {
        $match: {
          "powerInfo.canReceiveNotesheet": true
        }
      },
      {
        $project: {
          role_id: 1,
          role_name: 1,
          dept_id: 1,
          power_id: 1
        }
      }
    ]);

    return res.json({
      success: true,
      count: roles.length,
      data: roles
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });

  }
};