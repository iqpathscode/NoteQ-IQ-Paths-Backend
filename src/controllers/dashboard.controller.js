import Notesheet from "../models/notes/notesheet.model.js";
import Application from "../models/application/Application.model.js";
import Department from "../models/office/department.model.js";
import Employee from "../models/user/employee.model.js";

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

// Same logic for BOTH notesheet and application now — no more type-specific overrides.
// forwarded = IN_EXECUTION + QUERY_RAISED, closed = CLOSED (its own bucket).
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
    else if (status === "PENDING") summary.pending += 1;
    else if (status === "IN_EXECUTION") summary.forwarded += 1;
    else if (status === "QUERY_RAISED") summary.forwarded += 1;
    else if (status === "REJECTED") summary.rejected += 1;
    else if (status === "CLOSED") summary.closed += 1;
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
    else if (item.status === "PENDING") entry.pending += 1;
    else if (item.status === "IN_EXECUTION") entry.forwarded += 1;
    else if (item.status === "QUERY_RAISED") entry.forwarded += 1;
    else if (item.status === "REJECTED") entry.rejected += 1;
    else if (item.status === "CLOSED") entry.closed += 1;
  });

  const allEntry = ensureEntry("All");
  allEntry.approved = items.filter((item) => item.status === "APPROVED").length;
  allEntry.pending = items.filter((item) => item.status === "PENDING").length;
  allEntry.forwarded = items.filter((item) => item.status === "IN_EXECUTION" || item.status === "QUERY_RAISED").length;
  allEntry.rejected = items.filter((item) => item.status === "REJECTED").length;
  allEntry.closed = items.filter((item) => item.status === "CLOSED").length;
  allEntry.total = items.length;

  return Array.from(statsByDepartment.values()).filter((entry) => entry.name !== "All").concat([allEntry]);
};

const buildRecentActivities = (items, employeesById, departmentsById, type) => {
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
  const cutoff = Date.now() - TWELVE_HOURS_MS;

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
      id: item.note_id || item.application_id || `${type}-${item._id}`,
      title: item.subject || item.title || "Untitled",
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
    const [notesheets, applications, departments, employees] = await Promise.all([
      Notesheet.find({ is_deleted: { $ne: true } }).lean(),
      Application.find({ is_deleted: { $ne: true } }).lean(),
      Department.find({}).lean(),
      Employee.find({}, { emp_id: 1, emp_name: 1 }).lean(),
    ]);

    const departmentsById = new Map(departments.map((dept) => [dept.dept_id, dept.dept_name]));
    const employeesById = new Map(employees.map((employee) => [employee.emp_id, employee.emp_name]));

    const notesheetSummary = buildSummary(notesheets);
    const notesheetDepartmentStats = buildDepartmentStats(notesheets, departmentsById);
    const notesheetActivities = buildRecentActivities(notesheets, employeesById, departmentsById, "notesheet");

    const applicationSummary = buildSummary(applications);
    const applicationDepartmentStats = buildDepartmentStats(applications, departmentsById);
    const applicationActivities = buildRecentActivities(applications, employeesById, departmentsById, "application");

    return res.status(200).json({
      success: true,
      message: "Combined dashboard data fetched successfully",
      data: {
        notesheet: {
          summary: notesheetSummary,
          byDepartment: notesheetDepartmentStats,
          recentActivities: notesheetActivities,
        },
        application: {
          summary: applicationSummary,
          byDepartment: applicationDepartmentStats,
          recentActivities: applicationActivities,
        },
      },
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
