import LeaveWorkflow from "../models/leave/LeaveWorkflow.model.js";
import Role from "../models/userPowers/role.model.js";
import Power from "../models/userPowers/power.model.js";
import Employee from "../models/user/employee.model.js";
import Department from "../models/office/department.model.js";
import { Counter } from "../models/counter/counter.model.js";

export const seedDefaultWorkflows = async () => {
  try {
    const existingCount = await LeaveWorkflow.countDocuments();
    if (existingCount > 0) return;

    const roles = await Role.find().lean();
    const hodRole = roles.find((r) => /hod/i.test(r.role_name));
    const deanRole = roles.find((r) => /dean/i.test(r.role_name) && !/ass/i.test(r.role_name)) || roles.find((r) => /dean/i.test(r.role_name));
    const vcRole = roles.find((r) => /vc/i.test(r.role_name) || /director/i.test(r.role_name));
    const hrRole = roles.find((r) => /hr/i.test(r.role_name));

    const defaultWorkflows = [];

    if (hodRole && deanRole && vcRole) {
      defaultWorkflows.push({
        workflow_id: "WF_HOD_FLOW",
        workflow_name: "HOD Leave Approval Flow",
        applies_to_type: "SPECIFIC_ROLE",
        target_role_id: hodRole.role_id,
        dept_id: null,
        is_default: false,
        steps: [
          { step_number: 1, step_label: `First Authority (${deanRole.role_name})`, role_id: deanRole.role_id, is_final_step: false },
          { step_number: 2, step_label: `Final Authority (${vcRole.role_name})`, role_id: vcRole.role_id, is_final_step: true },
        ],
      });
    }

    if (hrRole && vcRole) {
      defaultWorkflows.push({
        workflow_id: "WF_HR_FLOW",
        workflow_name: "HR Department Leave Flow",
        applies_to_type: "SPECIFIC_ROLE",
        target_role_id: hrRole.role_id,
        dept_id: null,
        is_default: false,
        steps: [
          { step_number: 1, step_label: `Final Authority (${vcRole.role_name})`, role_id: vcRole.role_id, is_final_step: true },
        ],
      });
    }

    if (defaultWorkflows.length > 0) {
      await LeaveWorkflow.insertMany(defaultWorkflows);
      console.log(`Seeded ${defaultWorkflows.length} default workflows using existing roles!`);
    }
  } catch (err) {
    console.error("seedDefaultWorkflows error:", err);
  }
};

export const getSystemRoles = async (req, res) => {
  try {
    const [roles, powers, departments, employees] = await Promise.all([
      Role.find().sort({ role_id: 1 }).lean(),
      Power.find().lean(),
      Department.find().select("dept_id dept_name").lean(),
      Employee.find().select("emp_id emp_name role_ids active_role_id").lean(),
    ]);

    const powerMap = Object.fromEntries(powers.map((p) => [p.power_id, p]));
    const deptMap = Object.fromEntries(departments.map((d) => [d.dept_id, d.dept_name]));

    const enriched = roles.map((r) => {
      const p = powerMap[r.power_id];
      const assignedEmps = employees.filter(
        (e) => (e.role_ids && e.role_ids.includes(r.role_id)) || e.active_role_id === r.role_id
      );
      return {
        role_id: r.role_id,
        role_name: r.role_name,
        power_id: r.power_id,
        power_name: p?.power_name || "Custom Power",
        power_level: p?.power_level || 0,
        power_type: p?.power_type || "OTHER",
        canReceiveNotesheet: r.canReceiveNotesheet || false,
        canReceiveLeaveRequest: r.canReceiveLeaveRequest || false,
        dept_names: (r.dept_ids || []).map((id) => deptMap[id] || `Dept ${id}`),
        assigned_count: assignedEmps.length,
      };
    });

    return res.status(200).json({ success: true, data: enriched });
  } catch (error) {
    console.error("getSystemRoles error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch system roles." });
  }
};

export const toggleRoleLeavePermission = async (req, res) => {
  try {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ success: false, message: "Access denied. Only administrators can configure role permissions." });
    }
    const { id } = req.params;
    const { canReceiveLeaveRequest } = req.body;
    const role = await Role.findOne({ role_id: Number(id) });
    if (!role) return res.status(404).json({ success: false, message: "Role not found." });
    role.canReceiveLeaveRequest = Boolean(canReceiveLeaveRequest);
    await role.save();
    return res.status(200).json({ success: true, message: "Role updated.", data: role });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to update role." });
  }
};

export const getLeaveWorkflows = async (req, res) => {
  try {
    await seedDefaultWorkflows();
    const [workflows, roles, powers, departments] = await Promise.all([
      LeaveWorkflow.find().sort({ createdAt: -1 }).lean(),
      Role.find().lean(),
      Power.find().lean(),
      Department.find().select("dept_id dept_name").lean(),
    ]);

    const roleMap = Object.fromEntries(roles.map((r) => [r.role_id, r]));
    const powerMap = Object.fromEntries(powers.map((p) => [p.power_id, p]));
    const deptMap = Object.fromEntries(departments.map((d) => [d.dept_id, d.dept_name]));

    const enriched = workflows.map((wf) => ({
      ...wf,
      target_role_name: wf.target_role_id ? roleMap[wf.target_role_id]?.role_name : null,
      department_name: wf.dept_id ? deptMap[wf.dept_id] : "All Departments (Global)",
      steps: (wf.steps || []).map((s) => {
        const r = roleMap[s.role_id];
        const p = r ? powerMap[r.power_id] : null;
        return {
          ...s,
          role_name: r?.role_name || `Role ${s.role_id}`,
          role_level: p?.power_level || s.step_number,
        };
      }),
    }));

    return res.status(200).json({ success: true, data: enriched });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to fetch workflows." });
  }
};

export const createLeaveWorkflow = async (req, res) => {
  try {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ success: false, message: "Access denied. Only system administrators can create approval workflows." });
    }
    const { workflow_name, applies_to_type = "ALL_FACULTY", target_role_id = null, dept_id = null, steps = [] } = req.body;
    if (!workflow_name || !workflow_name.trim()) return res.status(400).json({ success: false, message: "Workflow name required." });
    if (!steps || steps.length === 0) return res.status(400).json({ success: false, message: "Approval steps required." });

    const counter = await Counter.findOneAndUpdate({ name: "leave_workflow_id" }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
    const workflow_id = `WF_${String(counter.seq).padStart(4, "0")}`;
    const formattedSteps = steps.map((s, idx) => ({
      step_number: idx + 1,
      step_label: s.step_label || (idx === steps.length - 1 ? "Final Approval Authority" : `Authority Level ${idx + 1}`),
      role_id: Number(s.role_id),
      specific_emp_id: s.specific_emp_id ? Number(s.specific_emp_id) : null,
      is_final_step: idx === steps.length - 1,
    }));

    const approverRoleIds = formattedSteps.map((s) => s.role_id);
    await Role.updateMany({ role_id: { $in: approverRoleIds } }, { $set: { canReceiveLeaveRequest: true } });

    const newWorkflow = await LeaveWorkflow.create({ workflow_id, workflow_name: workflow_name.trim(), applies_to_type, target_role_id: target_role_id ? Number(target_role_id) : null, dept_id: dept_id ? Number(dept_id) : null, steps: formattedSteps });
    return res.status(201).json({ success: true, message: "Workflow created successfully.", data: newWorkflow });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to create workflow." });
  }
};

export const updateLeaveWorkflow = async (req, res) => {
  try {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ success: false, message: "Access denied. Only system administrators can modify approval workflows." });
    }
    const { id } = req.params;
    const { workflow_name, applies_to_type, target_role_id, dept_id, steps, is_active } = req.body;
    const wf = await LeaveWorkflow.findOne({ workflow_id: id });
    if (!wf) return res.status(404).json({ success: false, message: "Workflow not found." });
    if (workflow_name !== undefined) wf.workflow_name = workflow_name.trim();
    if (applies_to_type !== undefined) wf.applies_to_type = applies_to_type;
    if (target_role_id !== undefined) wf.target_role_id = target_role_id ? Number(target_role_id) : null;
    if (dept_id !== undefined) wf.dept_id = dept_id ? Number(dept_id) : null;
    if (is_active !== undefined) wf.is_active = Boolean(is_active);
    if (steps && Array.isArray(steps) && steps.length > 0) {
      wf.steps = steps.map((s, idx) => ({
        step_number: idx + 1,
        step_label: s.step_label || (idx === steps.length - 1 ? "Final Approval Authority" : `Authority Level ${idx + 1}`),
        role_id: Number(s.role_id),
        specific_emp_id: s.specific_emp_id ? Number(s.specific_emp_id) : null,
        is_final_step: idx === steps.length - 1,
      }));
      const approverRoleIds = wf.steps.map((s) => s.role_id);
      await Role.updateMany({ role_id: { $in: approverRoleIds } }, { $set: { canReceiveLeaveRequest: true } });
    }
    await wf.save();
    return res.status(200).json({ success: true, message: "Workflow updated.", data: wf });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to update workflow." });
  }
};

export const deleteLeaveWorkflow = async (req, res) => {
  try {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ success: false, message: "Access denied. Only system administrators can delete approval workflows." });
    }
    const { id } = req.params;
    await LeaveWorkflow.deleteOne({ workflow_id: id });
    return res.status(200).json({ success: true, message: "Workflow deleted." });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to delete workflow." });
  }
};