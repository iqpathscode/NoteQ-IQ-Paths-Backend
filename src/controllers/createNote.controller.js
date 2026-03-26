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
      forward_to_role, // only for direct mode
      attachment,
      mode, // 0 = chain, 1 = direct
    } = req.body;

    // ------------------- Validations -------------------
    const sender = await Employee.findOne({ emp_id });
    if (!sender) {
      return res.status(404).json({
        success: false,
        message: "Sender employee not found",
      });
    }

    const department = await Department.findOne({ dept_id });
    if (!department) {
      return res.status(404).json({
        success: false,
        message: "Department not found",
      });
    }

    let forward_to_role_id = null;
    let forward_to_dept_id = null;
    let level = 1;

    // ------------------- DIRECT MODE -------------------
    if (Number(mode) === 1) {
      if (!forward_to_role) {
        return res.status(400).json({
          success: false,
          message: "forward_to_role is required in direct mode",
        });
      }

      const role = await Role.findOne({
        role_id: Number(forward_to_role),
      });

      if (!role) {
        return res.status(404).json({
          success: false,
          message: "Target role not found",
        });
      }

      if (!role.canReceiveNotesheet) {
        return res.status(403).json({
          success: false,
          message: "This role cannot receive notesheets",
        });
      }

      forward_to_role_id = role.role_id;
      forward_to_dept_id = dept_id; 
      level = role.power_level;
    }

    // ------------------- CHAIN MODE -------------------
    if (Number(mode) === 0) {
      //  Get employee role level
      const employeeLevel = sender.active_role?.power_level || 0;

      //  Find next higher role in same department
      const roles = await Role.find({
        dept_ids: Number(dept_id), 
        canReceiveNotesheet: true,
        power_level: { $gt: employeeLevel }, // higher than employee
      }).sort({ power_level: 1 }); // lowest first

      if (!roles || roles.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No approver roles found for this department",
        });
      }

      const firstRole = roles[0];

      forward_to_role_id = firstRole.role_id;
      forward_to_dept_id = dept_id;
      level = firstRole.power_level;
    }

    // ------------------- COUNTER -------------------
    const counter = await Counter.findOneAndUpdate(
      { name: "note_id" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    // ------------------- CREATE NOTESHEET -------------------
    const notesheet = await Notesheet.create({
      note_id: counter.seq,
      emp_id,
      dept_id,
      subject,
      description,
      forward_to_role_id,
      forward_to_dept_id,
      attachment,
      mode: Number(mode),
      level,
      status: "PENDING",
    });

    // ------------------- CREATE FLOW -------------------
    await NotesheetFlow.create({
      note_id: notesheet.note_id,
      from_emp_id: emp_id,
      to_role_id: forward_to_role_id,
      to_dept_id: forward_to_dept_id,
      action: "CREATED",
      remark: null,
      level,
    });

    return res.status(201).json({
      success: true,
      message: "Notesheet created successfully",
      data: notesheet,
    });

  } catch (error) {
    console.error("Create Notesheet Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const forwardChainOnly = async (req, res) => {
  try {
    const { note_id, forward_to_role, remark } = req.body;
    const user = req.user;

    const notesheet = await Notesheet.findOne({
      note_id: Number(note_id),
      forward_to_role_id: user.role_id,
    });

    if (!notesheet || notesheet.mode !== 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid chain notesheet",
      });
    }

    const role = await Role.findOne({ role_id: user.role_id });

   
    // OPEN FLOW (Dean ke baad)

    if (notesheet.is_open_flow && !forward_to_role) {
      const roles = await Role.find({
        canReceiveNotesheet: true,
      });

      return res.json({
        success: true,
        message: "Select role to forward",
        dropdownOptions: roles,
      });
    }

    
    //  AUTO FORWARD (LOWER LEVELS)
    
    if (!forward_to_role && !notesheet.is_open_flow) {
      const nextRole = await Role.findOne({
        power_level: { $gt: role.power_level },
        dept_ids: user.dept_id,
        canReceiveNotesheet: true,
      }).sort({ power_level: 1 });

      // If Dean reached
      if (role.role_name.toLowerCase() === "dean" && !forward_to_role) {
  const higherRoles = await Role.find({
    power_level: { $gt: role.power_level },
    canReceiveNotesheet: true,
  });

  return res.json({
    success: true,
    isDeanMode: true, 
    dropdownOptions: higherRoles,
    message: "Select role to forward",
  });
}
      if (!nextRole) {
        return res.json({
          success: false,
          message: "No next role found",
        });
      }

      notesheet.forward_to_role_id = nextRole.role_id;
      notesheet.forward_to_dept_id = user.dept_id;
      notesheet.level = nextRole.power_level;

      await notesheet.save();

      await NotesheetFlow.create({
        note_id: notesheet.note_id,
        from_emp_id: user.emp_id,
        from_role_id: user.role_id,
        to_role_id: nextRole.role_id,
        to_dept_id: user.dept_id,
        action: "FORWARDED",
        remark: remark || null,
        level: nextRole.power_level,
        final_status: "PENDING",
      });

      return res.json({
        success: true,
        message: "Forwarded to next level",
      });
    }

    
    //  MANUAL FORWARD (OPEN FLOW / DEAN)
    if (forward_to_role) {
      const nextRole = await Role.findOne({
        role_id: forward_to_role,
        canReceiveNotesheet: true,
      });

      if (!nextRole) {
        return res.status(404).json({
          success: false,
          message: "Selected role not found",
        });
      }

      notesheet.forward_to_role_id = nextRole.role_id;
      notesheet.forward_to_dept_id =
        nextRole.dept_ids?.[0] || user.dept_id;
      notesheet.level = nextRole.power_level;

      await notesheet.save();

      await NotesheetFlow.create({
        note_id: notesheet.note_id,
        from_emp_id: user.emp_id,
        from_role_id: user.role_id,
        to_role_id: nextRole.role_id,
        to_dept_id: notesheet.forward_to_dept_id,
        action: "FORWARDED",
        remark: remark || null,
        level: nextRole.power_level,
        final_status: "PENDING",
      });

      return res.json({
        success: true,
        message: "Forwarded successfully",
      });
    }

  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const getEligibleRoles = async (req, res) => {
  try {
    const roles = await Role.find({ canReceiveNotesheet: true }).select(
      "role_id role_name dept_id power_id",
    );

    return res.json({
      success: true,
      count: roles.length,
      data: roles,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};