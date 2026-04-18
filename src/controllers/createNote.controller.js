import Notesheet from "../models/notes/notesheet.model.js";
import { Counter } from "../models/counter/counter.model.js";
import Employee from "../models/user/employee.model.js";
import Department from "../models/office/department.model.js";
import Role from "../models/userPowers/role.model.js";
import NotesheetFlow from "../models/notes/notesheetFlow.model.js";
import Power from "../models/userPowers/power.model.js";

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

    // ------------------- VALIDATIONS -------------------
    const sender = await Employee.findOne({ emp_id });
    if (!sender)
      return res
        .status(404)
        .json({ success: false, message: "Sender not found" });

    const department = await Department.findOne({ dept_id });
    if (!department)
      return res
        .status(404)
        .json({ success: false, message: "Department not found" });

    let forward_to_role_id = null;
    let forward_to_dept_id = null;
    let level = null;

    // ------------------- HANDLE ROLE -------------------
    let roleId = null;
    let roleName = "Employee"; // default
    let employeeLevel = 0;     // default

    if (sender.active_role_id) {
      const activeRole = await Role.findOne({ role_id: sender.active_role_id });
      if (activeRole) {
        roleId = activeRole.role_id;
        roleName = activeRole.role_name;
        const power = await Power.findOne({ power_id: activeRole.power_id });
        if (power) employeeLevel = power.power_level;
      }
    }
    // agar role nahi hai → Employee default, power_level 0, roleId null

    // ------------------- DIRECT MODE -------------------
    if (Number(mode) === 1) {
      if (!forward_to_role)
        return res.status(400).json({
          success: false,
          message: "forward_to_role is required in direct mode",
        });

      const role = await Role.findOne({ role_id: Number(forward_to_role) });
      if (!role)
        return res
          .status(404)
          .json({ success: false, message: "Target role not found" });
      if (!role.canReceiveNotesheet)
        return res.status(403).json({
          success: false,
          message: "This role cannot receive notesheets",
        });

      const power = await Power.findOne({ power_id: role.power_id });
      if (!power)
        return res
          .status(404)
          .json({ success: false, message: "Power not found for role" });

      forward_to_role_id = role.role_id;
      forward_to_dept_id = dept_id;
      level = power.power_level;
    }

    // ------------------- CHAIN MODE -------------------
    if (Number(mode) === 0) {
      const roles = await Role.find({
        dept_ids: { $in: [Number(dept_id)] },
        canReceiveNotesheet: true,
      });

      let roleWithLevel = [];
      for (let r of roles) {
        const power = await Power.findOne({ power_id: r.power_id });
        if (power)
          roleWithLevel.push({ ...r.toObject(), power_level: power.power_level });
      }

      roleWithLevel.sort((a, b) => a.power_level - b.power_level);
      const nextRole = roleWithLevel.find((r) => r.power_level > employeeLevel);

      if (!nextRole)
        return res.status(404).json({
          success: false,
          message: "You are at highest level, no next approver",
        });

      forward_to_role_id = nextRole.role_id;
      forward_to_dept_id = dept_id;
      level = nextRole.power_level;
    }

    if (!level)
      return res.status(400).json({
        success: false,
        message: "Level missing. Cannot create notesheet flow.",
      });

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
      created_by_emp_id: sender.emp_id,
      created_by_role_id: roleId, // null allowed if no role
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
      to_emp_id: null, // current holder optional
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
    console.log("===== Forward Chain Start =====");

    const { note_id, forward_to_role, remark } = req.body;
    const user = req.user;

    // HELPER (VERY IMPORTANT)
    const ensureCreatedFields = (notesheet, userRoleId) => {
      if (!notesheet.created_by_emp_id) {
        notesheet.created_by_emp_id = notesheet.emp_id;
      }

      if (!notesheet.created_by_role_id) {
        notesheet.created_by_role_id = userRoleId;
      }
    };

    // Step 0: Active Role
    const userRoleId =
      user.active_role_id ||
      user.role_id ||
      (await Employee.findOne({ emp_id: user.emp_id }))?.active_role_id;

    if (!userRoleId) {
      return res.status(400).json({
        success: false,
        message: "User role not found",
      });
    }

    // Step 1: Fetch notesheet
    const notesheet = await Notesheet.findOne({
      note_id: Number(note_id),
      forward_to_dept_id: Number(user.dept_id),
    });

    if (!notesheet) {
      return res.status(400).json({
        success: false,
        message: "Notesheet not found for your department",
      });
    }

    if (notesheet.mode !== 0) {
      return res.status(400).json({
        success: false,
        message: "This is not a chain notesheet",
      });
    }

    
    // Step 2: Fetch role + employee + power
    const [employee, role] = await Promise.all([
      Employee.findOne({ emp_id: user.emp_id }),
      Role.findOne({ role_id: userRoleId }),
    ]);

    if (!role) {
      return res.status(400).json({
        success: false,
        message: "Role not found",
      });
    }

    const power = await Power.findOne({ power_id: role.power_id });

    if (!power) {
      return res.status(400).json({
        success: false,
        message: "Power not found",
      });
    }

    const userPowerLevel = power.power_level;
    const userPowerType = power.power_type;

    // Step 3: Update level
    if (!notesheet.level || notesheet.level < userPowerLevel) {
      notesheet.level = userPowerLevel;
      notesheet.forward_to_role_id = role.role_id;

      ensureCreatedFields(notesheet, userRoleId); 
      await notesheet.save();
    }

    // Step 4: Auto-forward (APPROVAL)
    if (!forward_to_role && userPowerType === "APPROVAL") {
      const allRoles = await Role.find({
        canReceiveNotesheet: true,
        dept_ids: user.dept_id,
      });

      const rolesWithPower = await Promise.all(
        allRoles.map(async (r) => {
          const p = await Power.findOne({ power_id: r.power_id });
          return { role: r, power: p };
        })
      );

      const nextRoleCandidate = rolesWithPower
        .filter(
          (rp) =>
            rp.power?.power_type === "APPROVAL" &&
            rp.power.power_level > notesheet.level
        )
        .sort((a, b) => a.power.power_level - b.power.power_level)[0];

      if (nextRoleCandidate) {
        const nr = nextRoleCandidate.role;
        const np = nextRoleCandidate.power;

        notesheet.forward_to_role_id = nr.role_id;
        notesheet.forward_to_dept_id = user.dept_id;
        notesheet.level = np.power_level;

        ensureCreatedFields(notesheet, userRoleId);

        await notesheet.save();

        await NotesheetFlow.create({
          note_id: notesheet.note_id,
          from_emp_id: user.emp_id,
          from_emp_name: employee?.emp_name || "Unknown User",
          from_role_id: userRoleId,
          from_role_name: role.role_name,
          to_emp_id: null,
          to_emp_name: null,
          to_role_id: nr.role_id,
          to_role_name: nr.role_name,
          to_dept_id: user.dept_id,
          action: "FORWARDED",
          remark: remark || null,
          level: np.power_level,
          final_status: "PENDING",
        });

        return res.json({
          success: true,
          message: `Auto-forwarded to ${nr.role_name}`,
        });
      }
    }

    
    // Step 5: Dropdown
    if (!forward_to_role) {
      const allRoles = await Role.find({
        canReceiveNotesheet: true,
        dept_ids: user.dept_id,
      });

      const rolesWithPower = await Promise.all(
        allRoles.map(async (r) => {
          const p = await Power.findOne({ power_id: r.power_id });
          return { role: r, power: p };
        })
      );

      const higherRoles = rolesWithPower
        .filter((rp) => rp.power?.power_level > notesheet.level)
        .sort((a, b) => a.power.power_level - b.power.power_level)
        .map((rp) => rp.role);

      return res.json({
        success: true,
        isDeanMode: userPowerType !== "APPROVAL",
        message: "Select role to forward",
        dropdownOptions: higherRoles,
      });
    }

    // -------------------------------
    // Step 6: Manual forward
    // -------------------------------
    const nextRole = await Role.findOne({
      role_id: forward_to_role,
      canReceiveNotesheet: true,
    });

    if (!nextRole) {
      return res.status(404).json({
        success: false,
        message: "Target role not found",
      });
    }

    const nextPower = await Power.findOne({
      power_id: nextRole.power_id,
    });

    notesheet.forward_to_role_id = nextRole.role_id;
    notesheet.forward_to_dept_id =
      nextRole.dept_ids?.[0] || user.dept_id;
    notesheet.level = nextPower?.power_level || notesheet.level;

    ensureCreatedFields(notesheet, userRoleId);

    await notesheet.save();

    await NotesheetFlow.create({
      note_id: notesheet.note_id,
      from_emp_id: user.emp_id,
      from_emp_name: employee?.emp_name || "Unknown User",
      from_role_id: userRoleId,
      from_role_name: role.role_name,
      to_emp_id: null,
      to_emp_name: null,
      to_role_id: nextRole.role_id,
      to_role_name: nextRole.role_name,
      to_dept_id: notesheet.forward_to_dept_id,
      action: "FORWARDED",
      remark: remark || null,
      level: nextPower?.power_level || notesheet.level,
      final_status: "PENDING",
    });

    return res.json({
      success: true,
      message: `Forwarded to ${nextRole.role_name}`,
    });

  } catch (error) {
    console.error("Forward Chain Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
export const getEligibleRoles = async (req, res) => {
  try {
    const { note_id, mode } = req.query;
    const user = req.user;

    // fetch all roles that can receive notesheet
    let roles = await Role.find({ canReceiveNotesheet: true });

    // fetch power and dept info manually
    const powers = await Power.find();
    const depts = await Department.find();

    // enrich roles with power_level and dept_name
    roles = roles.map((r) => {
      const power = powers.find((p) => p.power_id === r.power_id);
      const deptNames = r.dept_ids.map(
        (dId) => depts.find((d) => d.dept_id === dId)?.dept_name || "Dept"
      );

      return {
        ...r.toObject(),
        power_level: power?.power_level || 0,
        dept_name: deptNames.join(", "),
      };
    });

    if (mode === "direct") {
      // exclude user's own role
      roles = roles.filter((r) => r.role_id !== user.active_role_id);
    } else if (mode === "chain") {
      const notesheet = await Notesheet.findOne({ note_id: Number(note_id) });
      if (!notesheet)
        return res
          .status(404)
          .json({ success: false, message: "Notesheet not found" });

      // filter eligible roles
      roles = roles.filter((r) => {
        // higher-level global roles: dept irrelevant
        if (r.dept_ids.length === 0) {
          return r.power_level > (notesheet.level || 0);
        }
        // normal roles: must match dept and higher power
        return (
          r.power_level > (notesheet.level || 0) &&
          r.dept_ids.includes(user.dept_id)
        );
      });
    }

    console.log("Eligible roles:", roles);

    return res.json({
      success: true,
      count: roles.length,
      data: roles,
    });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};