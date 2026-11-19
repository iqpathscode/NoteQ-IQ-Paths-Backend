import Employee from "../models/user/employee.model.js";
import Role from "../models/userPowers/role.model.js";

/**
 * isRegistrar Middleware
 * Ensures that only an authenticated employee with the designation or role of "Registrar"
 * (or a Super Admin for testing/administrative purposes) can access the route.
 */
export const isRegistrar = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Allow Admin / Super Admin bypass for management and administration
    if (req.user.isAdmin) {
      req.registrar = {
        emp_id: 0,
        emp_name: req.user.name || "University Admin",
        designation: "Registrar (Authorized Admin)",
        signature: null,
      };
      return next();
    }

    if (req.user.emp_id) {
      const employee = await Employee.findOne({ emp_id: req.user.emp_id }).lean();
      if (!employee) {
        return res.status(403).json({
          success: false,
          message: "Employee profile not found",
        });
      }

      // 1. Check if base designation is Registrar
      if (employee.designation && /registrar/i.test(employee.designation)) {
        req.registrar = employee;
        return next();
      }

      // 2. Check current active role strictly
      const currentActiveRoleId = req.user.active_role_id ?? employee.active_role_id;
      if (currentActiveRoleId) {
        const activeRoleDoc = await Role.findOne({
          role_id: Number(currentActiveRoleId),
        }).lean();

        if (activeRoleDoc && /registrar/i.test(activeRoleDoc.role_name)) {
          req.registrar = employee;
          return next();
        }
      }

      // 3. Fallback: Check if employee holds ANY assigned role with "registrar"
      if (Array.isArray(employee.role_ids) && employee.role_ids.length > 0) {
        const employeeRoles = await Role.find({
          role_id: { $in: employee.role_ids },
        }).lean();

        if (employeeRoles.some((r) => /registrar/i.test(r.role_name))) {
          req.registrar = employee;
          return next();
        }
      }
    }

    return res.status(403).json({
      success: false,
      message: "Access Denied: Only the Registrar is authorized to issue or manage NOCs and Purchase Orders.",
    });
  } catch (error) {
    console.error("[isRegistrar Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server authorization error",
    });
  }
};
