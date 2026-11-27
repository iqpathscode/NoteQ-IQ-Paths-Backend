import Notesheet from "../models/notes/notesheet.model.js";
import Application from "../models/application/Application.model.js";
import LeaveRequest from "../models/leave/LeaveRequest.model.js";
import Department from "../models/office/department.model.js";
import Employee from "../models/user/employee.model.js";
import AppConfig from "../models/counter/AppConfig.js";
import { getOrSetCache } from "../utility/cache.utils.js";

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

const RECENT_ACTIVITIES_LIMIT = 50;

const bucketExpr = {
  $switch: {
    branches: [
      { case: { $eq: ["$status", "APPROVED"] }, then: "approved" },
      {
        case: {
          $or: [
            { $eq: ["$status", "CLOSED"] },
            { $eq: ["$status", "CANCELLED"] },
            { $eq: ["$lifecycle_status", "CLOSED"] },
          ],
        },
        then: "closed",
      },
      { case: { $eq: ["$status", "REJECTED"] }, then: "rejected" },
      {
        case: {
          $or: [
            { $eq: ["$status", "IN_EXECUTION"] },
            { $eq: ["$status", "QUERY_RAISED"] },
            {
              $and: [
                { $eq: ["$status", "PENDING"] },
                { $ne: ["$forward_to_emp_id", null] },
                { $ne: ["$forward_to_emp_id", 0] },
              ],
            },
          ],
        },
        then: "forwarded",
      },
    ],
    default: "pending",
  },
};

const aggregateModuleStats = async (Model, idField, titleField, cutoffDate) => {
  const [result] = await Model.aggregate([
    { $match: { is_deleted: { $ne: true } } },
    {
      $facet: {
        byDept: [
          { $addFields: { _bucket: bucketExpr } },
          {
            $group: {
              _id: "$dept_id",
              approved: { $sum: { $cond: [{ $eq: ["$_bucket", "approved"] }, 1, 0] } },
              pending: { $sum: { $cond: [{ $eq: ["$_bucket", "pending"] }, 1, 0] } },
              forwarded: { $sum: { $cond: [{ $eq: ["$_bucket", "forwarded"] }, 1, 0] } },
              rejected: { $sum: { $cond: [{ $eq: ["$_bucket", "rejected"] }, 1, 0] } },
              closed: { $sum: { $cond: [{ $eq: ["$_bucket", "closed"] }, 1, 0] } },
              total: { $sum: 1 },
            },
          },
        ],
        recent: [
          {
            $addFields: {
              _activityDate: {
                $ifNull: ["$createdAt", { $ifNull: ["$received_at", "$updatedAt"] }],
              },
            },
          },
          { $match: { _activityDate: { $gte: cutoffDate } } },
          { $sort: { _activityDate: -1 } },
          { $limit: RECENT_ACTIVITIES_LIMIT },
          {
            $project: {
              [idField]: 1,
              dept_id: 1,
              status: 1,
              emp_id: 1,
              created_by_emp_id: 1,
              [titleField]: 1,
              _activityDate: 1,
            },
          },
        ],
      },
    },
  ]);

  return result || { byDept: [], recent: [] };
};

const formatAggregatedModule = (aggResult, departmentsById, employeesById, type, idField, titleField) => {
  const summary = {
    approved: 0,
    pending: 0,
    forwarded: 0,
    rejected: 0,
    closed: 0,
    total: 0,
  };

  const deptEntries = [];
  for (const row of aggResult.byDept || []) {
    const deptName = departmentsById.get(row._id) || `Department ${row._id}`;
    const entry = {
      name: deptName,
      approved: row.approved || 0,
      pending: row.pending || 0,
      forwarded: row.forwarded || 0,
      rejected: row.rejected || 0,
      closed: row.closed || 0,
      total: row.total || 0,
    };
    deptEntries.push(entry);

    summary.approved += entry.approved;
    summary.pending += entry.pending;
    summary.forwarded += entry.forwarded;
    summary.rejected += entry.rejected;
    summary.closed += entry.closed;
    summary.total += entry.total;
  }

  const byDepartment = deptEntries.concat([{ name: "All", ...summary }]);

  const recentActivities = (aggResult.recent || []).map((item) => {
    const empId = item.emp_id || item.created_by_emp_id;
    const userName = employeesById.get(empId) || "Unknown User";
    const deptName = departmentsById.get(item.dept_id) || "Unknown Department";
    const statusInfo = getStatusInfo(item.status);

    return {
      id: item[idField] || `${type}-${item._id}`,
      title: item[titleField] || "Untitled",
      user: userName,
      dept: deptName,
      status: statusInfo.label,
      statusColor: statusInfo.statusColor,
      bg: "bg-white hover:border-emerald-200",
      time: getTimeAgo(item._activityDate),
    };
  });

  return { summary, byDepartment, recentActivities };
};

export const getCombinedDashboardData = async (req, res) => {
  try {
    const responseData = await getOrSetCache("dashboard:combined", 15, async () => {
      const appConfig = await AppConfig.findOne({ key: "app_config" }).select("modules").lean();
      const modules = appConfig?.modules || {
        notesheet: true,
        application: true,
        leave: true,
      };

      const isNotesheetEnabled = modules.notesheet !== false;
      const isApplicationEnabled = modules.application !== false;
      const isLeaveEnabled = modules.leave !== false;

      const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const [departments, notesAgg, appAgg, leaveAgg] = await Promise.all([
        Department.find({}, { dept_id: 1, dept_name: 1 }).lean(),
        isNotesheetEnabled
          ? aggregateModuleStats(Notesheet, "note_id", "subject", cutoffDate)
          : Promise.resolve(null),
        isApplicationEnabled
          ? aggregateModuleStats(Application, "application_id", "subject", cutoffDate)
          : Promise.resolve(null),
        isLeaveEnabled
          ? aggregateModuleStats(LeaveRequest, "leave_id", "reason", cutoffDate)
          : Promise.resolve(null),
      ]);

      const recentEmpIds = new Set();
      for (const agg of [notesAgg, appAgg, leaveAgg]) {
        if (!agg?.recent) continue;
        for (const item of agg.recent) {
          const id = item.emp_id || item.created_by_emp_id;
          if (id) recentEmpIds.add(id);
        }
      }

      const employees = recentEmpIds.size
        ? await Employee.find(
            { emp_id: { $in: Array.from(recentEmpIds) } },
            { emp_id: 1, emp_name: 1 }
          ).lean()
        : [];

      const departmentsById = new Map(departments.map((dept) => [dept.dept_id, dept.dept_name]));
      const employeesById = new Map(employees.map((employee) => [employee.emp_id, employee.emp_name]));

      return {
        notesheet: notesAgg
          ? formatAggregatedModule(notesAgg, departmentsById, employeesById, "notesheet", "note_id", "subject")
          : null,
        application: appAgg
          ? formatAggregatedModule(appAgg, departmentsById, employeesById, "application", "application_id", "subject")
          : null,
        leave: leaveAgg
          ? formatAggregatedModule(leaveAgg, departmentsById, employeesById, "leave", "leave_id", "reason")
          : null,
      };
    });

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
