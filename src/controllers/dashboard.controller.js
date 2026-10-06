import Notesheet from "../models/notes/notesheet.model.js";
import Application from "../models/application/Application.model.js";
import LeaveRequest from "../models/leave/LeaveRequest.model.js";
import Department from "../models/office/department.model.js";
import Employee from "../models/user/employee.model.js";
import AppConfig from "../models/counter/AppConfig.js";

const STATUS_STYLES = {
  APPROVED: {
    label: "Approved",
    statusColor: "text-emerald-700 bg-emerald-50 border border-emerald-200",
  },
  PENDING: {
    label: "Pending",
    statusColor: "text-amber-700 bg-amber-50 border border-amber-200",
  },
  IN_EXECUTION: {
    label: "Forwarded",
    statusColor: "text-blue-700 bg-blue-50 border border-blue-200",
  },
  REJECTED: {
    label: "Rejected",
    statusColor: "text-rose-700 bg-rose-50 border border-rose-200",
  },
  QUERY_RAISED: {
    label: "Forwarded",
    statusColor: "text-blue-700 bg-blue-50 border border-blue-200",
  },
  CLOSED: {
    label: "Closed",
    statusColor: "text-slate-700 bg-slate-100 border border-slate-200",
  },
  CANCELLED: {
    label: "Cancelled",
    statusColor: "text-slate-700 bg-slate-100 border border-slate-200",
  },
};

const getTimeAgo = (value) => {
  if (!value) return "Just now";

  const diffMs = Date.now() - new Date(value).getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
};

const getStatusInfo = (status) => {
  if (STATUS_STYLES[status]) return STATUS_STYLES[status];

  return {
    label: status || "Pending",
    statusColor: "text-slate-700 bg-slate-100 border border-slate-200",
  };
};

// Helper to detect forwarded / in-execution items
const isItemForwarded = (item) => {
  if (item.status === "IN_EXECUTION" || item.status === "QUERY_RAISED") return true;
  if (item.status === "PENDING") {
    if (item.forward_to_emp_id) return true;
    if (Array.isArray(item.action_history) && item.action_history.some((a) => a.action === "FORWARDED")) return true;
  }
  return false;
};

// Helper to detect closed / cancelled items
const isItemClosed = (item) => {
  return item.status === "CLOSED" || item.status === "CANCELLED" || item.lifecycle_status === "CLOSED";
};

// Unified summary logic for notesheet, application, and leave
const buildSummary = (items) => {
  const summary = {
    approved: 0,
    pending: 0,
    forwarded: 0,
    rejected: 0,
    closed: 0,
    total: items.length,
  };

  items.forEach((item) => {
    const status = item.status;

    if (status === "APPROVED") summary.approved += 1;
    else if (isItemClosed(item)) summary.closed += 1;
    else if (status === "REJECTED") summary.rejected += 1;
    else if (isItemForwarded(item)) summary.forwarded += 1;
    else if (status === "PENDING") summary.pending += 1;
    else summary.pending += 1;
  });

  return summary;
};

const buildDepartmentStats = (items, departmentNamesById) => {
  const statsByDepartment = new Map();

  const ensureEntry = (name) => {
    if (!statsByDepartment.has(name)) {
      statsByDepartment.set(name, {
        name,
        approved: 0,
        pending: 0,
        forwarded: 0,
        rejected: 0,
        closed: 0,
        total: 0,
      });
    }

    return statsByDepartment.get(name);
  };

  items.forEach((item) => {
    const deptId = item.dept_id;
    const deptName = departmentNamesById.get(deptId) || `Department ${deptId}`;
    const entry = ensureEntry(deptName);

    entry.total += 1;

    if (item.status === "APPROVED") entry.approved += 1;
    else if (isItemClosed(item)) entry.closed += 1;
    else if (item.status === "REJECTED") entry.rejected += 1;
    else if (isItemForwarded(item)) entry.forwarded += 1;
    else if (item.status === "PENDING") entry.pending += 1;
    else entry.pending += 1;
  });

  const allEntry = ensureEntry("All");
  allEntry.approved = items.filter((item) => item.status === "APPROVED").length;
  allEntry.pending = items.filter((item) => item.status === "PENDING" && !isItemForwarded(item)).length;
  allEntry.forwarded = items.filter((item) => isItemForwarded(item)).length;
  allEntry.rejected = items.filter((item) => item.status === "REJECTED").length;
  allEntry.closed = items.filter((item) => isItemClosed(item)).length;
  allEntry.total = items.length;

  return Array.from(statsByDepartment.values()).filter((entry) => entry.name !== "All").concat([allEntry]);
};

const buildRecentActivities = (items, employeesById, departmentsById, type) => {
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;

  // Strictly filter items within the last 24 hours
  const recentItems = items.filter((item) => {
    const dateValue = item.createdAt || item.received_at || item.updatedAt;
    if (!dateValue) return false;
    return new Date(dateValue).getTime() >= cutoff;
  });

  const sortedItems = [...recentItems].sort((a, b) => {
    const dateA = new Date(a.createdAt || a.received_at || a.updatedAt || 0).getTime();
    const dateB = new Date(b.createdAt || b.received_at || b.updatedAt || 0).getTime();
    return dateB - dateA; // newest first
  });

  return sortedItems.map((item) => {
    const empId = item.emp_id || item.created_by_emp_id;
    const userName = employeesById.get(empId) || "Unknown User";
    const deptName = departmentsById.get(item.dept_id) || "Unknown Department";
    const statusInfo = getStatusInfo(item.status);

    return {
      id: item.leave_id || item.note_id || item.application_id || `${type}-${item._id}`,
      title: item.reason || item.subject || item.title || "Untitled",
      user: userName,
      dept: deptName,
      status: statusInfo.label,
      statusColor: statusInfo.statusColor,
      bg: "bg-white hover:border-emerald-200",
      time: getTimeAgo(item.createdAt || item.received_at || item.updatedAt),
    };
  });
};

export const getCombinedDashboardData = async (req, res) => {
  try {
    const appConfig = await AppConfig.findOne({ key: "app_config" }).lean();
    const modules = appConfig?.modules || {
      notesheet: true,
      application: true,
      leave: true,
    };

    const isNotesheetEnabled = modules.notesheet !== false;
    const isApplicationEnabled = modules.application !== false;
    const isLeaveEnabled = modules.leave !== false;

    const [departments, employees, notesheets, applications, leaves] = await Promise.all([
      Department.find({}).lean(),
      Employee.find({}, { emp_id: 1, emp_name: 1 }).lean(),
      isNotesheetEnabled ? Notesheet.find({ is_deleted: { $ne: true } }).lean() : Promise.resolve([]),
      isApplicationEnabled ? Application.find({ is_deleted: { $ne: true } }).lean() : Promise.resolve([]),
      isLeaveEnabled ? LeaveRequest.find({ is_deleted: { $ne: true } }).lean() : Promise.resolve([]),
    ]);

    const departmentsById = new Map(departments.map((dept) => [dept.dept_id, dept.dept_name]));
    const employeesById = new Map(employees.map((employee) => [employee.emp_id, employee.emp_name]));

    const responseData = {
      notesheet: isNotesheetEnabled
        ? {
            summary: buildSummary(notesheets),
            byDepartment: buildDepartmentStats(notesheets, departmentsById),
            recentActivities: buildRecentActivities(notesheets, employeesById, departmentsById, "notesheet"),
          }
        : null,
      application: isApplicationEnabled
        ? {
            summary: buildSummary(applications),
            byDepartment: buildDepartmentStats(applications, departmentsById),
            recentActivities: buildRecentActivities(applications, employeesById, departmentsById, "application"),
          }
        : null,
      leave: isLeaveEnabled
        ? {
            summary: buildSummary(leaves),
            byDepartment: buildDepartmentStats(leaves, departmentsById),
            recentActivities: buildRecentActivities(leaves, employeesById, departmentsById, "leave"),
          }
        : null,
    };

    return res.status(200).json({
      success: true,
      message: "Combined dashboard data fetched successfully",
      data: responseData,
    });
  } catch (error) {
    console.error("Combined dashboard error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load combined dashboard data",
      error: error.message,
    });
  }
};
