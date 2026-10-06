import DownloadLog from "../models/audit/DownloadLog.model.js";
import Employee from "../models/user/employee.model.js";
import Role from "../models/userPowers/role.model.js";
import Department from "../models/office/department.model.js";
import { getReportScopeMatch } from "./report.controller.js";

/**
 * POST /api/downloads/log
 * Asynchronously log a PDF download event for audit and reporting
 */
export const logDownload = async (req, res) => {
  try {
    const {
      document_type,
      document_id,
      document_identifier = "",
      department_id,
    } = req.body;

    if (!document_type || !document_id) {
      return res.status(400).json({
        success: false,
        message: "document_type and document_id are required",
      });
    }

    const empId = req.user?.isAdmin ? null : Number(req.user?.emp_id);
    let empName = req.user?.isAdmin ? "Administrator" : "";
    let roleId = req.user?.active_role_id ? Number(req.user.active_role_id) : null;
    let roleName = req.user?.isAdmin ? "Admin" : "";
    let deptId = department_id ? Number(department_id) : null;
    let deptName = "";

    // Resolve employee & role details if employee
    if (empId) {
      const employee = await Employee.findOne({ emp_id: empId }).lean();
      if (employee) {
        empName = employee.emp_name || "";
        if (!roleId && employee.active_role_id) {
          roleId = employee.active_role_id;
        }
        if (!deptId && employee.dept_id) {
          deptId = employee.dept_id;
        }
      }
    }

    if (roleId) {
      const role = await Role.findOne({ role_id: roleId }).lean();
      if (role) {
        roleName = role.role_name || "";
      }
    }

    if (deptId) {
      const dept = await Department.findOne({ dept_id: deptId }).lean();
      if (dept) {
        deptName = dept.dept_name || "";
      }
    }

    const logEntry = await DownloadLog.create({
      document_type: String(document_type).toUpperCase(),
      document_id: String(document_id),
      document_identifier: String(document_identifier || document_id),
      downloaded_by: empId || 0,
      downloaded_by_name: empName,
      role_id: roleId,
      role_name: roleName,
      department_id: deptId,
      department_name: deptName,
      downloaded_at: new Date(),
    });

    return res.status(201).json({
      success: true,
      message: "Download logged successfully",
      data: logEntry,
    });
  } catch (error) {
    console.error("logDownload error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to log download event",
      error: error.message,
    });
  }
};

/**
 * GET /api/downloads/analytics
 * Retrieve download statistics, top downloaded documents, and department breakdown
 */
export const getDownloadAnalytics = async (req, res) => {
  try {
    const { scope, matchFilter } = await getReportScopeMatch(
      req.user,
      req.query,
      req.query.module || "all"
    );

    const matchStage = {};

    // Apply RBAC scope on downloads
    if (!scope.isAdmin) {
      if (scope.appViewScope === "OWN") {
        matchStage.downloaded_by = scope.empId;
      } else if (scope.appViewScope === "DEPARTMENT") {
        if (scope.accessibleDeptIds?.length) {
          matchStage.department_id = { $in: scope.accessibleDeptIds };
        }
      }
    }

    // Filter by module if provided
    if (req.query.module && req.query.module !== "all" && req.query.module !== "combined") {
      matchStage.document_type = String(req.query.module).toUpperCase();
    }

    // Filter by department if provided
    if (req.query.department_id) {
      const deptNum = Number(req.query.department_id);
      if (scope.isAdmin || scope.accessibleDeptIds.includes(deptNum)) {
        matchStage.department_id = deptNum;
      }
    }

    // Date range filter
    if (req.query.startDate || req.query.endDate) {
      matchStage.downloaded_at = {};
      if (req.query.startDate) {
        const start = new Date(req.query.startDate);
        start.setHours(0, 0, 0, 0);
        matchStage.downloaded_at.$gte = start;
      }
      if (req.query.endDate) {
        const end = new Date(req.query.endDate);
        end.setHours(23, 59, 59, 999);
        matchStage.downloaded_at.$lte = end;
      }
    }

    // Total downloads count
    const totalDownloads = await DownloadLog.countDocuments(matchStage);

    // Top Downloaded Documents
    const topDocuments = await DownloadLog.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: {
            document_id: "$document_id",
            document_type: "$document_type",
            document_identifier: "$document_identifier",
          },
          count: { $sum: 1 },
          lastDownloadedAt: { $max: "$downloaded_at" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
      {
        $project: {
          _id: 0,
          document_id: "$_id.document_id",
          document_type: "$_id.document_type",
          document_identifier: "$_id.document_identifier",
          count: 1,
          lastDownloadedAt: 1,
        },
      },
    ]);

    // Department Breakdown
    const departmentBreakdown = await DownloadLog.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: {
            dept_id: "$department_id",
            dept_name: "$department_name",
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      {
        $project: {
          _id: 0,
          dept_id: "$_id.dept_id",
          dept_name: { $ifNull: ["$_id.dept_name", "Unassigned"] },
          count: 1,
        },
      },
    ]);

    // Recent Download Logs List
    const downloadLogs = await DownloadLog.find(matchStage)
      .sort({ downloaded_at: -1 })
      .limit(200)
      .lean();

    return res.status(200).json({
      success: true,
      scope: {
        isAdmin: scope.isAdmin,
        appViewScope: scope.appViewScope,
        label: scope.scopeLabel,
      },
      analytics: {
        totalDownloads,
        topDocuments,
        departmentBreakdown,
        logs: downloadLogs,
      },
    });
  } catch (error) {
    console.error("getDownloadAnalytics error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch download analytics",
      error: error.message,
    });
  }
};
