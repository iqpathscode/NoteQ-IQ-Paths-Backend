import Notesheet from "../models/notes/notesheet.model.js";
import Application from "../models/application/Application.model.js";
import NotesheetFlow from "../models/notes/notesheetFlow.model.js";
import ApplicationFlow from "../models/application/ApplicationFlow.model.js";
import Employee from "../models/user/employee.model.js";
import Role from "../models/userPowers/role.model.js";
import Power from "../models/userPowers/power.model.js";
import Department from "../models/office/department.model.js";
import School from "../models/office/school.model.js";
import DownloadLog from "../models/audit/DownloadLog.model.js";
import * as XLSX from "xlsx";

/**
 * =========================================================================
 * 1. SHARED RBAC SCOPE MATCHER
 * Reuses the existing app_view_scope / view_scope on Role documents
 * Scope values: OWN | DEPARTMENT | ALL
 * =========================================================================
 */
export const getReportScopeMatch = async (user, requestedFilters = {}, moduleType = "all") => {
  if (user.isAdmin) {
    const accessibleDeptIds = [];
    const scope = {
      isAdmin: true,
      empId: null,
      activeRoleId: null,
      appViewScope: "ALL",
      powerScope: "GLOBAL",
      scopeLabel: "Administrator (All Organizations)",
      accessibleDeptIds,
    };

    const matchNotesheet = { is_deleted: { $ne: true } };
    const matchApplication = { is_deleted: { $ne: true } };

    // Admin can filter by specific departments if requested
    const targetDeptIds = parseDepartmentFilter(requestedFilters);
    if (targetDeptIds.length > 0) {
      matchNotesheet.dept_id = { $in: targetDeptIds };
      matchApplication.dept_id = { $in: targetDeptIds };
    }

    return { scope, matchNotesheet, matchApplication };
  }

  const empId = Number(user.emp_id);
  const employee = await Employee.findOne({ emp_id: empId }).lean();
  if (!employee) {
    throw new Error("Employee not found");
  }

  const activeRoleId = user.active_role_id ? Number(user.active_role_id) : employee.active_role_id;
  let activeRole = null;
  let power = null;

  if (activeRoleId) {
    activeRole = await Role.findOne({ role_id: activeRoleId }).lean();
    if (activeRole) {
      power = await Power.findOne({ power_id: activeRole.power_id }).lean();
    }
  }

  // ── STRICT HR & NON-APPROVER RESTRICTION ──────────────────────────────────
  if (
    activeRole &&
    (activeRole.role_name?.toLowerCase().includes("hr") ||
      power?.power_type === "HR" ||
      activeRole.canReceiveNotesheet === false)
  ) {
    throw new Error(
      "Access Denied: HR and non-approving roles do not have permission to view Notesheet or Application reports."
    );
  }

  // Derive scope strictly server-side
  const appViewScope = activeRole?.app_view_scope || activeRole?.view_scope || power?.scope || "OWN";
  const roleDeptIds = activeRole?.dept_ids || [];
  const viewDeptIds = activeRole?.view_dept_ids || [];
  const appViewDeptIds = activeRole?.app_view_dept_ids || [];
  const userDeptId = employee.dept_id;

  const accessibleDeptIds = [
    ...new Set([
      ...roleDeptIds,
      ...viewDeptIds,
      ...appViewDeptIds,
      userDeptId,
    ]),
  ].filter((id) => typeof id === "number" && !isNaN(id));

  const scope = {
    isAdmin: false,
    empId,
    activeRoleId,
    roleName: activeRole?.role_name || "Role Authority",
    appViewScope,
    powerScope: power?.scope || "DEPARTMENT",
    scopeLabel: `${activeRole?.role_name || "Employee"} (${appViewScope} Scope)`,
    accessibleDeptIds,
  };

  const matchNotesheet = { is_deleted: { $ne: true } };
  const matchApplication = { is_deleted: { $ne: true } };

  // ── OWN SCOPE: Only documents created or actioned by the logged-in employee ──
  if (appViewScope === "OWN") {
    // 1. Notesheets
    const flowNoteMatches = await NotesheetFlow.find(
      {
        $or: [
          { to_role_id: activeRoleId },
          { to_emp_id: empId },
          { from_role_id: activeRoleId },
          { from_emp_id: empId },
        ],
      },
      { note_id: 1 }
    ).lean();
    const flowNoteIds = flowNoteMatches.map((f) => f.note_id);

    const ownNoteMatches = await Notesheet.find(
      {
        $or: [
          { created_by_emp_id: empId },
          { created_by_role_id: activeRoleId },
          { current_holder_emp_id: empId },
          { forward_to_role_id: activeRoleId },
          { forward_to_emp_id: empId },
        ],
        is_deleted: { $ne: true },
      },
      { note_id: 1 }
    ).lean();
    const ownNoteIds = ownNoteMatches.map((n) => n.note_id);
    const accessibleNoteIds = [...new Set([...flowNoteIds, ...ownNoteIds])];
    matchNotesheet.note_id = { $in: accessibleNoteIds };

    // 2. Applications
    const flowAppMatches = await ApplicationFlow.find(
      {
        $or: [
          { to_role_id: activeRoleId },
          { to_emp_id: empId },
          { from_role_id: activeRoleId },
          { from_emp_id: empId },
        ],
      },
      { application_id: 1 }
    ).lean();
    const flowAppIds = flowAppMatches.map((f) => f.application_id);

    const ownAppMatches = await Application.find(
      {
        $or: [
          { emp_id: empId },
          { created_by_emp_id: empId },
          { submitted_by_role_id: activeRoleId },
          { created_by_role_id: activeRoleId },
          { current_holder_emp_id: empId },
          { current_holder_role_id: activeRoleId },
          { forward_to_role_id: activeRoleId },
        ],
        is_deleted: { $ne: true },
      },
      { application_id: 1 }
    ).lean();
    const ownAppIds = ownAppMatches.map((a) => a.application_id);
    const accessibleAppIds = [...new Set([...flowAppIds, ...ownAppIds])];
    matchApplication.application_id = { $in: accessibleAppIds };
  }
  // ── DEPARTMENT SCOPE: Locked to employee's authorized departments ──
  else if (appViewScope === "DEPARTMENT") {
    matchNotesheet.dept_id = { $in: accessibleDeptIds };
    matchApplication.dept_id = { $in: accessibleDeptIds };
  }
  // ── ALL SCOPE: Can view all departments ──
  else if (appViewScope === "ALL") {
    const targetDeptIds = parseDepartmentFilter(requestedFilters);
    if (targetDeptIds.length > 0) {
      matchNotesheet.dept_id = { $in: targetDeptIds };
      matchApplication.dept_id = { $in: targetDeptIds };
    }
  }

  return { scope, matchNotesheet, matchApplication };
};

/**
 * Helper to parse department filters from query
 */
function parseDepartmentFilter(filters = {}) {
  const targetDeptIds = [];
  if (filters.dept_id) targetDeptIds.push(Number(filters.dept_id));
  if (filters.department_id) targetDeptIds.push(Number(filters.department_id));
  if (filters.departments) {
    const arr = Array.isArray(filters.departments)
      ? filters.departments
      : String(filters.departments).split(",");
    arr.forEach((id) => {
      const num = Number(String(id).trim());
      if (!isNaN(num)) targetDeptIds.push(num);
    });
  }
  if (filters.dept_ids) {
    const arr = String(filters.dept_ids).split(",");
    arr.forEach((id) => {
      const num = Number(String(id).trim());
      if (!isNaN(num)) targetDeptIds.push(num);
    });
  }
  return [...new Set(targetDeptIds)].filter((id) => !isNaN(id));
}

/**
 * Helper to apply common dimension filters (Date, Status, Priority, Employee, Category, Search)
 */
function applyDimensionFilters(baseMatch, queryParams = {}, module = "notesheet") {
  const match = { ...baseMatch };
  const {
    datePreset,
    startDate,
    endDate,
    status,
    statuses,
    priority,
    category,
    applicationType,
    emp_id,
    employee_id,
    search,
  } = queryParams;

  // 1. Date Range & Presets
  const dateRange = resolveDateRange(datePreset, startDate, endDate);
  if (dateRange) {
    match.createdAt = dateRange;
  }

  // 2. Status Filter (Single or Array)
  const targetStatuses = [];
  if (status && status !== "all" && status !== "ALL") {
    targetStatuses.push(status.toUpperCase());
  }
  if (statuses) {
    const arr = Array.isArray(statuses) ? statuses : String(statuses).split(",");
    arr.forEach((s) => {
      const trimmed = s.trim().toUpperCase();
      if (trimmed && trimmed !== "ALL") targetStatuses.push(trimmed);
    });
  }
  if (targetStatuses.length > 0) {
    match.status = { $in: [...new Set(targetStatuses)] };
  }

  // 3. Priority Filter
  if (priority && priority !== "all" && priority !== "ALL") {
    match.priority = priority.toLowerCase();
  }

  // 4. Employee Filter
  const targetEmpId = emp_id || employee_id;
  if (targetEmpId) {
    const empNum = Number(targetEmpId);
    if (!isNaN(empNum)) {
      if (module === "application") {
        match.$or = [{ emp_id: empNum }, { created_by_emp_id: empNum }];
      } else {
        match.created_by_emp_id = empNum;
      }
    }
  }

  // 5. Category / Application Type Filter
  if (module === "notesheet" && category && category !== "all" && category !== "ALL") {
    match.category = category;
  }
  if (module === "application" && applicationType && applicationType !== "all" && applicationType !== "ALL") {
    match.applicationType = applicationType;
  }

  // 6. Text Search
  if (search && search.trim()) {
    const term = search.trim();
    const regex = { $regex: term, $options: "i" };
    const searchConditions =
      module === "application"
        ? [
            { application_id: regex },
            { subject: regex },
            { description: regex },
            { applicationType: regex },
            { emp_name: regex },
          ]
        : [
            { note_id: regex },
            { subject: regex },
            { description: regex },
            { category: regex },
          ];

    if (match.$or) {
      match.$and = [{ $or: match.$or }, { $or: searchConditions }];
      delete match.$or;
    } else {
      match.$or = searchConditions;
    }
  }

  return match;
}

/**
 * Resolves Date Range filter object from presets or custom inputs
 */
function resolveDateRange(preset, customStart, customEnd) {
  const now = new Date();

  if (preset === "day" || preset === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { $gte: start, $lte: end };
  }

  if (preset === "yesterday") {
    const start = new Date(now);
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setDate(end.getDate() - 1);
    end.setHours(23, 59, 59, 999);
    return { $gte: start, $lte: end };
  }

  if (preset === "week" || preset === "7d") {
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { $gte: start, $lte: end };
  }

  if (preset === "month" || preset === "this_month" || preset === "30d") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { $gte: start, $lte: end };
  }

  if (preset === "year" || preset === "this_year") {
    const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { $gte: start, $lte: end };
  }

  if (customStart || customEnd) {
    const range = {};
    if (customStart) {
      const s = new Date(customStart);
      s.setHours(0, 0, 0, 0);
      range.$gte = s;
    }
    if (customEnd) {
      const e = new Date(customEnd);
      e.setHours(23, 59, 59, 999);
      range.$lte = e;
    }
    return range;
  }

  return null;
}

/**
 * Dynamic MongoDB Period String expression for $group
 */
function getPeriodExpression(granularity = "month") {
  switch (granularity.toLowerCase()) {
    case "day":
      return { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
    case "week":
      return {
        $concat: [
          { $dateToString: { format: "%Y-W", date: "$createdAt" } },
          { $toString: { $isoWeek: "$createdAt" } },
        ],
      };
    case "year":
      return { $dateToString: { format: "%Y", date: "$createdAt" } };
    case "month":
    default:
      return { $dateToString: { format: "%Y-%m", date: "$createdAt" } };
  }
}

/**
 * =========================================================================
 * 2. GET /api/reports/filter-options
 * Returns accessible dropdown parameters strictly respecting RBAC scope
 * =========================================================================
 */
export const getReportFilterOptions = async (req, res) => {
  try {
    const moduleType = (req.query.module || req.query.reportType || "combined").toLowerCase();
    const { scope } = await getReportScopeMatch(req.user, req.query, moduleType);

    let departments = [];
    let schools = [];
    let roles = [];
    let employees = [];

    if (scope.isAdmin || scope.appViewScope === "ALL") {
      [schools, departments, roles, employees] = await Promise.all([
        School.find({}, { school_id: 1, school_name: 1, _id: 0 }).sort({ school_name: 1 }).lean(),
        Department.find({}, { dept_id: 1, dept_name: 1, school_id: 1, _id: 0 }).sort({ dept_name: 1 }).lean(),
        Role.find({}, { role_id: 1, role_name: 1, dept_ids: 1, _id: 0 }).sort({ role_name: 1 }).lean(),
        Employee.find({ is_active: true }, { emp_id: 1, emp_name: 1, dept_id: 1, designation: 1, _id: 0 }).sort({ emp_name: 1 }).lean(),
      ]);
    } else if (scope.appViewScope === "DEPARTMENT") {
      departments = await Department.find(
        { dept_id: { $in: scope.accessibleDeptIds } },
        { dept_id: 1, dept_name: 1, school_id: 1, _id: 0 }
      ).sort({ dept_name: 1 }).lean();

      const schoolIds = [...new Set(departments.map((d) => d.school_id).filter(Boolean))];
      schools = await School.find(
        { school_id: { $in: schoolIds } },
        { school_id: 1, school_name: 1, _id: 0 }
      ).sort({ school_name: 1 }).lean();

      roles = await Role.find(
        {
          $or: [
            { dept_ids: { $in: scope.accessibleDeptIds } },
            { role_id: scope.activeRoleId },
          ],
        },
        { role_id: 1, role_name: 1, dept_ids: 1, _id: 0 }
      ).sort({ role_name: 1 }).lean();

      employees = await Employee.find(
        { dept_id: { $in: scope.accessibleDeptIds }, is_active: true },
        { emp_id: 1, emp_name: 1, dept_id: 1, designation: 1, _id: 0 }
      ).sort({ emp_name: 1 }).lean();
    } else {
      // OWN Scope: Only self
      employees = await Employee.find(
        { emp_id: scope.empId },
        { emp_id: 1, emp_name: 1, dept_id: 1, designation: 1, _id: 0 }
      ).lean();

      departments = await Department.find(
        { dept_id: { $in: scope.accessibleDeptIds } },
        { dept_id: 1, dept_name: 1, school_id: 1, _id: 0 }
      ).lean();
    }

    const [categories, applicationTypes] = await Promise.all([
      Notesheet.distinct("category", { is_deleted: { $ne: true } }),
      Application.distinct("applicationType", { is_deleted: { $ne: true } }),
    ]);

    return res.status(200).json({
      success: true,
      scope: {
        isAdmin: scope.isAdmin,
        appViewScope: scope.appViewScope,
        scopeLabel: scope.scopeLabel,
        isDepartmentPickerVisible: scope.isAdmin || scope.appViewScope === "ALL",
      },
      filterOptions: {
        schools,
        departments,
        roles,
        employees,
        categories: categories.filter(Boolean).sort(),
        applicationTypes: applicationTypes.filter(Boolean).sort(),
        priorities: ["low", "medium", "high", "normal", "urgent"],
        statuses: ["PENDING", "IN_EXECUTION", "QUERY_RAISED", "APPROVED", "REJECTED", "CLOSED"],
        datePresets: [
          { label: "Today", value: "day" },
          { label: "Last 7 Days", value: "week" },
          { label: "This Month", value: "month" },
          { label: "This Year", value: "year" },
          { label: "All Time", value: "all" },
          { label: "Custom Range", value: "custom" },
        ],
        groupByDimensions: [
          { label: "Department", value: "department" },
          { label: "Employee", value: "employee" },
          { label: "Period (Month)", value: "period" },
          { label: "Department × Period", value: "department_period" },
        ],
      },
    });
  } catch (error) {
    console.error("getReportFilterOptions error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch filter options",
      error: error.message,
    });
  }
};

/**
 * =========================================================================
 * 3. GET /api/reports/summary
 * Computes aggregated summary metrics, GroupBy breakdown, TAT, & Downloads
 * =========================================================================
 */
export const getReportSummary = async (req, res) => {
  try {
    const moduleType = (req.query.module || "combined").toLowerCase();
    const groupBy = (req.query.groupBy || "department").toLowerCase();
    const granularity = (req.query.granularity || req.query.datePreset || "month").toLowerCase();

    const { scope, matchNotesheet, matchApplication } = await getReportScopeMatch(
      req.user,
      req.query,
      moduleType
    );

    const finalNotesheetMatch = applyDimensionFilters(matchNotesheet, req.query, "notesheet");
    const finalApplicationMatch = applyDimensionFilters(matchApplication, req.query, "application");

    const periodExpr = getPeriodExpression(granularity);

    // Dynamic Group Key construction
    const buildGroupKey = (modulePrefix = "") => {
      const creatorField = modulePrefix === "app" ? "$emp_id" : "$created_by_emp_id";

      if (groupBy === "employee") {
        return { emp_id: creatorField };
      }
      if (groupBy === "period") {
        return { period: periodExpr };
      }
      if (groupBy === "department_period") {
        return { dept_id: "$dept_id", period: periodExpr };
      }
      // Default: department
      return { dept_id: "$dept_id" };
    };

    // TAT calculation expression (days between createdAt and resolution)
    // Resolution is calculated from updatedAt if final status reached
    const tatDaysExpression = {
      $cond: [
        { $in: ["$status", ["APPROVED", "REJECTED", "CLOSED"]] },
        {
          $divide: [
            { $subtract: ["$updatedAt", "$createdAt"] },
            1000 * 60 * 60 * 24, // convert ms to days
          ],
        },
        null,
      ],
    };

    // ── NOTESHEET AGGREGATION ──
    const notesheetGroupStage = {
      _id: buildGroupKey("notesheet"),
      totalCreated: { $sum: 1 },
      totalApproved: { $sum: { $cond: [{ $eq: ["$status", "APPROVED"] }, 1, 0] } },
      totalRejected: { $sum: { $cond: [{ $eq: ["$status", "REJECTED"] }, 1, 0] } },
      totalPending: {
        $sum: {
          $cond: [{ $in: ["$status", ["PENDING", "IN_EXECUTION", "QUERY_RAISED"]] }, 1, 0],
        },
      },
      totalClosed: { $sum: { $cond: [{ $eq: ["$status", "CLOSED"] }, 1, 0] } },
      avgTATDays: { $avg: tatDaysExpression },
    };

    // ── APPLICATION AGGREGATION ──
    const applicationGroupStage = {
      _id: buildGroupKey("app"),
      totalCreated: { $sum: 1 },
      totalApproved: { $sum: { $cond: [{ $eq: ["$status", "APPROVED"] }, 1, 0] } },
      totalRejected: { $sum: { $cond: [{ $eq: ["$status", "REJECTED"] }, 1, 0] } },
      totalPending: {
        $sum: {
          $cond: [{ $in: ["$status", ["PENDING", "IN_EXECUTION", "QUERY_RAISED"]] }, 1, 0],
        },
      },
      totalClosed: { $sum: { $cond: [{ $eq: ["$status", "CLOSED"] }, 1, 0] } },
      avgTATDays: { $avg: tatDaysExpression },
    };

    let notesheetGroups = [];
    let applicationGroups = [];

    if (moduleType === "notesheet" || moduleType === "combined" || moduleType === "all") {
      notesheetGroups = await Notesheet.aggregate([
        { $match: finalNotesheetMatch },
        { $group: notesheetGroupStage },
      ]);
    }

    if (moduleType === "application" || moduleType === "combined" || moduleType === "all") {
      applicationGroups = await Application.aggregate([
        { $match: finalApplicationMatch },
        { $group: applicationGroupStage },
      ]);
    }

    // ── FETCH DOWNLOADS STATS FOR MATCHING SCOPE & DATES ──
    const downloadMatch = {};
    if (!scope.isAdmin) {
      if (scope.appViewScope === "OWN") {
        downloadMatch.downloaded_by = scope.empId;
      } else if (scope.appViewScope === "DEPARTMENT" && scope.accessibleDeptIds?.length) {
        downloadMatch.department_id = { $in: scope.accessibleDeptIds };
      }
    }
    if (finalNotesheetMatch.createdAt) {
      downloadMatch.downloaded_at = finalNotesheetMatch.createdAt;
    }

    const downloadGroups = await DownloadLog.aggregate([
      { $match: downloadMatch },
      {
        $group: {
          _id:
            groupBy === "employee"
              ? { emp_id: "$downloaded_by" }
              : groupBy === "period"
              ? { period: { $dateToString: { format: "%Y-%m", date: "$downloaded_at" } } }
              : { dept_id: "$department_id" },
          totalDownloads: { $sum: 1 },
        },
      },
    ]);

    const downloadCountMap = new Map();
    downloadGroups.forEach((d) => {
      const key = makeGroupKeyString(d._id);
      downloadCountMap.set(key, d.totalDownloads);
    });

    // ── COMBINE & MERGE AGGREGATIONS ──
    const mergedMap = new Map();

    const processGroupItem = (item, typeName) => {
      const key = makeGroupKeyString(item._id);
      if (!mergedMap.has(key)) {
        mergedMap.set(key, {
          groupId: item._id,
          totalCreated: 0,
          totalApproved: 0,
          totalRejected: 0,
          totalPending: 0,
          totalClosed: 0,
          tatSum: 0,
          tatCount: 0,
        });
      }
      const acc = mergedMap.get(key);
      acc.totalCreated += item.totalCreated || 0;
      acc.totalApproved += item.totalApproved || 0;
      acc.totalRejected += item.totalRejected || 0;
      acc.totalPending += item.totalPending || 0;
      acc.totalClosed += item.totalClosed || 0;
      if (item.avgTATDays != null && !isNaN(item.avgTATDays)) {
        acc.tatSum += item.avgTATDays * (item.totalApproved + item.totalRejected || 1);
        acc.tatCount += item.totalApproved + item.totalRejected || 1;
      }
    };

    notesheetGroups.forEach((g) => processGroupItem(g, "notesheet"));
    applicationGroups.forEach((g) => processGroupItem(g, "application"));

    // ── ENRICH WITH NAMES (Department, Employee, School) ──
    const [allDepts, allEmps] = await Promise.all([
      Department.find({}, { dept_id: 1, dept_name: 1, school_id: 1 }).lean(),
      Employee.find({}, { emp_id: 1, emp_name: 1, designation: 1, dept_id: 1 }).lean(),
    ]);

    const deptMap = new Map(allDepts.map((d) => [d.dept_id, d.dept_name]));
    const empMap = new Map(allEmps.map((e) => [e.emp_id, e]));

    // Format final rows
    let summaryRows = Array.from(mergedMap.entries()).map(([key, data]) => {
      const gid = data.groupId;
      const deptId = gid?.dept_id;
      const empId = gid?.emp_id;
      const period = gid?.period || "All Time";

      const deptName = deptId != null ? deptMap.get(deptId) || "Unassigned Dept" : null;
      const empObj = empId != null ? empMap.get(empId) : null;
      const empName = empObj ? empObj.emp_name : empId ? `Emp ${empId}` : null;
      const designation = empObj?.designation || "";

      const approvalRate =
        data.totalCreated > 0
          ? Number(((data.totalApproved / data.totalCreated) * 100).toFixed(1))
          : 0;

      const rawTAT = data.tatCount > 0 ? data.tatSum / data.tatCount : 0;
      const avgTATFormatted = formatTATDays(rawTAT);

      const downloads = downloadCountMap.get(key) || 0;

      return {
        dimensionKey: key,
        dept_id: deptId,
        department: deptName,
        emp_id: empId,
        employee: empName,
        designation,
        period,
        totalCreated: data.totalCreated,
        totalApproved: data.totalApproved,
        totalRejected: data.totalRejected,
        totalPending: data.totalPending,
        totalClosed: data.totalClosed,
        approvalRate,
        avgTATDays: Number(rawTAT.toFixed(2)),
        avgTATFormatted,
        downloads,
      };
    });

    // Sort summary rows
    summaryRows.sort((a, b) => b.totalCreated - a.totalCreated);

    // Compute Overall Totals
    const overall = {
      totalDocuments: summaryRows.reduce((sum, r) => sum + r.totalCreated, 0),
      totalApproved: summaryRows.reduce((sum, r) => sum + r.totalApproved, 0),
      totalRejected: summaryRows.reduce((sum, r) => sum + r.totalRejected, 0),
      totalPending: summaryRows.reduce((sum, r) => sum + r.totalPending, 0),
      totalClosed: summaryRows.reduce((sum, r) => sum + r.totalClosed, 0),
      totalDownloads: Array.from(downloadCountMap.values()).reduce((sum, count) => sum + count, 0),
    };
    overall.overallApprovalRate =
      overall.totalDocuments > 0
        ? Number(((overall.totalApproved / overall.totalDocuments) * 100).toFixed(1))
        : 0;

    const totalDecided = overall.totalApproved + overall.totalRejected;
    const overallTATSum = summaryRows.reduce(
      (sum, r) => sum + (r.avgTATDays || 0) * (r.totalApproved + r.totalRejected),
      0
    );
    overall.overallAvgTAT =
      totalDecided > 0 ? formatTATDays(overallTATSum / totalDecided) : "—";

    return res.status(200).json({
      success: true,
      module: moduleType,
      groupBy,
      granularity,
      scope: {
        isAdmin: scope.isAdmin,
        appViewScope: scope.appViewScope,
        scopeLabel: scope.scopeLabel,
      },
      overall,
      data: summaryRows,
    });
  } catch (error) {
    console.error("getReportSummary error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate report summary",
      error: error.message,
    });
  }
};

/**
 * =========================================================================
 * 4. GET /api/reports/generate
 * Generates detailed listing of individual records matching filters & scope
 * =========================================================================
 */
export const generateReport = async (req, res) => {
  try {
    const moduleType = (req.query.module || req.query.reportType || "notesheet").toLowerCase();
    const { scope, matchNotesheet, matchApplication } = await getReportScopeMatch(
      req.user,
      req.query,
      moduleType
    );

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = req.query.limit === "all" ? 10000 : Math.max(1, Math.min(1000, Number(req.query.limit) || 25));
    const sortBy = req.query.sortBy || "createdAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;

    let allMatching = [];

    // ── APPLICATION DETAILED LISTING ──
    if (moduleType === "application") {
      const finalMatch = applyDimensionFilters(matchApplication, req.query, "application");
      allMatching = await Application.aggregate([
        { $match: finalMatch },
        {
          $lookup: {
            from: "employees",
            localField: "emp_id",
            foreignField: "emp_id",
            as: "applicant",
          },
        },
        { $unwind: { path: "$applicant", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "departments",
            localField: "dept_id",
            foreignField: "dept_id",
            as: "department",
          },
        },
        { $unwind: { path: "$department", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "schools",
            localField: "department.school_id",
            foreignField: "school_id",
            as: "school",
          },
        },
        { $unwind: { path: "$school", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "roles",
            localField: "submitted_by_role_id",
            foreignField: "role_id",
            as: "submitRole",
          },
        },
        { $unwind: { path: "$submitRole", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "roles",
            localField: "current_holder_role_id",
            foreignField: "role_id",
            as: "holderRole",
          },
        },
        { $unwind: { path: "$holderRole", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "roles",
            localField: "forward_to_role_id",
            foreignField: "role_id",
            as: "forwardRole",
          },
        },
        { $unwind: { path: "$forwardRole", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "downloadlogs",
            let: { docId: "$application_id" },
            pipeline: [
              { $match: { $expr: { $and: [{ $eq: ["$document_id", "$$docId"] }, { $eq: ["$document_type", "APPLICATION"] }] } } },
              { $count: "count" },
            ],
            as: "downloadStats",
          },
        },
        {
          $project: {
            _id: 0,
            document_type: { $literal: "APPLICATION" },
            application_id: 1,
            note_id: "$application_id",
            subject: 1,
            title: "$subject",
            description: 1,
            applicationType: 1,
            category: "$applicationType",
            priority: 1,
            status: 1,
            mode: 1,
            level: 1,
            lifecycle_status: 1,
            fromDate: 1,
            toDate: 1,
            reference_notesheet_id: { $ifNull: ["$reference_notesheet_id", null] },
            createdAt: 1,
            updatedAt: 1,
            date: "$createdAt",
            attachments: { $ifNull: ["$attachments", []] },
            attachmentCount: { $size: { $ifNull: ["$attachments", []] } },
            downloadsCount: { $ifNull: [{ $arrayElemAt: ["$downloadStats.count", 0] }, 0] },
            emp_id: 1,
            emp_name: { $ifNull: ["$emp_name", "$applicant.emp_name", "Unknown"] },
            designation: { $ifNull: ["$applicant.designation", "—"] },
            email: { $ifNull: ["$applicant.email", "—"] },
            dept_id: 1,
            dept_name: { $ifNull: ["$department.dept_name", "Unassigned"] },
            school_id: "$department.school_id",
            school_name: { $ifNull: ["$school.school_name", "General"] },
            submitted_by_role_name: { $ifNull: ["$submitted_by_role_name", "$submitRole.role_name", "Employee"] },
            role_name: { $ifNull: ["$submitted_by_role_name", "$submitRole.role_name", "Employee"] },
            current_holder_name: { $ifNull: ["$current_holder_emp_name", "$holderRole.role_name", "—"] },
            forward_to_role_name: { $ifNull: ["$forward_to_role_name", "$forwardRole.role_name", "—"] },
          },
        },
      ]);
    }
    // ── NOTESHEET DETAILED LISTING (DEFAULT) ──
    else {
      const finalMatch = applyDimensionFilters(matchNotesheet, req.query, "notesheet");
      allMatching = await Notesheet.aggregate([
        { $match: finalMatch },
        {
          $lookup: {
            from: "employees",
            localField: "created_by_emp_id",
            foreignField: "emp_id",
            as: "creator",
          },
        },
        { $unwind: { path: "$creator", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "departments",
            localField: "dept_id",
            foreignField: "dept_id",
            as: "department",
          },
        },
        { $unwind: { path: "$department", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "schools",
            localField: "department.school_id",
            foreignField: "school_id",
            as: "school",
          },
        },
        { $unwind: { path: "$school", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "roles",
            localField: "created_by_role_id",
            foreignField: "role_id",
            as: "creatorRole",
          },
        },
        { $unwind: { path: "$creatorRole", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "employees",
            localField: "current_holder_emp_id",
            foreignField: "emp_id",
            as: "currentHolder",
          },
        },
        { $unwind: { path: "$currentHolder", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "roles",
            localField: "forward_to_role_id",
            foreignField: "role_id",
            as: "forwardRole",
          },
        },
        { $unwind: { path: "$forwardRole", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "downloadlogs",
            let: { docId: "$note_id" },
            pipeline: [
              { $match: { $expr: { $and: [{ $eq: ["$document_id", "$$docId"] }, { $eq: ["$document_type", "NOTESHEET"] }] } } },
              { $count: "count" },
            ],
            as: "downloadStats",
          },
        },
        {
          $project: {
            _id: 0,
            document_type: { $literal: "NOTESHEET" },
            note_id: 1,
            application_id: "$note_id",
            subject: 1,
            title: "$subject",
            description: 1,
            category: 1,
            priority: 1,
            status: 1,
            mode: 1,
            level: 1,
            lifecycle_status: 1,
            createdAt: 1,
            updatedAt: 1,
            date: "$createdAt",
            attachments: { $ifNull: ["$attachments", []] },
            attachmentCount: { $size: { $ifNull: ["$attachments", []] } },
            downloadsCount: { $ifNull: [{ $arrayElemAt: ["$downloadStats.count", 0] }, 0] },
            emp_id: "$created_by_emp_id",
            emp_name: { $ifNull: ["$creator.emp_name", "$emp_name", "Unknown"] },
            designation: { $ifNull: ["$creator.designation", "—"] },
            email: { $ifNull: ["$creator.email", "—"] },
            dept_id: 1,
            dept_name: { $ifNull: ["$department.dept_name", "Unassigned"] },
            school_id: "$department.school_id",
            school_name: { $ifNull: ["$school.school_name", "General"] },
            created_by_role_name: { $ifNull: ["$creatorRole.role_name", "Personal / Faculty"] },
            role_name: { $ifNull: ["$creatorRole.role_name", "Personal / Faculty"] },
            current_holder_name: { $ifNull: ["$currentHolder.emp_name", "—"] },
            forward_to_role_name: { $ifNull: ["$forwardRole.role_name", "—"] },
          },
        },
      ]);
    }

    // Sort matching records
    allMatching.sort((a, b) => {
      let valA = a[sortBy] ?? "";
      let valB = b[sortBy] ?? "";

      if (sortBy === "createdAt" || sortBy === "date" || sortBy === "updatedAt") {
        valA = new Date(valA || 0).getTime();
        valB = new Date(valB || 0).getTime();
      } else if (typeof valA === "string") {
        valA = valA.toLowerCase();
        valB = String(valB).toLowerCase();
      }

      if (valA < valB) return sortOrder === 1 ? -1 : 1;
      if (valA > valB) return sortOrder === 1 ? 1 : -1;
      return 0;
    });

    const totalCount = allMatching.length;
    const paginatedRecords = allMatching.slice((page - 1) * limit, page * limit);
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    return res.status(200).json({
      success: true,
      module: moduleType,
      scope: {
        isAdmin: scope.isAdmin,
        appViewScope: scope.appViewScope,
        scopeLabel: scope.scopeLabel,
      },
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
      },
      data: paginatedRecords,
    });
  } catch (error) {
    console.error("generateReport error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate detailed report",
      error: error.message,
    });
  }
};

/**
 * =========================================================================
 * 5. GET /api/reports/export
 * Exports formatted Excel (.xlsx) with Summary Matrix & Detailed Records
 * =========================================================================
 */
export const exportReport = async (req, res) => {
  try {
    const moduleType = (req.query.module || req.query.reportType || "notesheet").toLowerCase();
    const format = (req.query.format || "excel").toLowerCase();
    const dateStr = new Date().toISOString().slice(0, 10);

    const { scope, matchNotesheet, matchApplication } = await getReportScopeMatch(
      req.user,
      req.query,
      moduleType
    );

    const wb = XLSX.utils.book_new();

    // 1. Fetch Summary Data
    // We reuse the same aggregation logic as getReportSummary
    const isApp = moduleType === "application";
    const finalMatch = isApp
      ? applyDimensionFilters(matchApplication, req.query, "application")
      : applyDimensionFilters(matchNotesheet, req.query, "notesheet");

    const detailedRecords = isApp
      ? await Application.aggregate([
          { $match: finalMatch },
          {
            $lookup: {
              from: "employees",
              localField: "emp_id",
              foreignField: "emp_id",
              as: "applicant",
            },
          },
          { $unwind: { path: "$applicant", preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: "departments",
              localField: "dept_id",
              foreignField: "dept_id",
              as: "department",
            },
          },
          { $unwind: { path: "$department", preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: "schools",
              localField: "department.school_id",
              foreignField: "school_id",
              as: "school",
            },
          },
          { $unwind: { path: "$school", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 0,
              id: "$application_id",
              subject: 1,
              type: "$applicationType",
              emp_name: { $ifNull: ["$applicant.emp_name", "$emp_name", "Unknown"] },
              designation: { $ifNull: ["$applicant.designation", "—"] },
              dept_name: { $ifNull: ["$department.dept_name", "Unassigned"] },
              school_name: { $ifNull: ["$school.school_name", "General"] },
              status: 1,
              priority: { $toUpper: "$priority" },
              mode: { $cond: [{ $eq: ["$mode", 1] }, "Direct", "Chain"] },
              refNotesheet: { $ifNull: ["$reference_notesheet_id", "—"] },
              createdAt: 1,
            },
          },
        ])
      : await Notesheet.aggregate([
          { $match: finalMatch },
          {
            $lookup: {
              from: "employees",
              localField: "created_by_emp_id",
              foreignField: "emp_id",
              as: "creator",
            },
          },
          { $unwind: { path: "$creator", preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: "departments",
              localField: "dept_id",
              foreignField: "dept_id",
              as: "department",
            },
          },
          { $unwind: { path: "$department", preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: "schools",
              localField: "department.school_id",
              foreignField: "school_id",
              as: "school",
            },
          },
          { $unwind: { path: "$school", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 0,
              id: "$note_id",
              subject: 1,
              type: "$category",
              emp_name: { $ifNull: ["$creator.emp_name", "$emp_name", "Unknown"] },
              designation: { $ifNull: ["$creator.designation", "—"] },
              dept_name: { $ifNull: ["$department.dept_name", "Unassigned"] },
              school_name: { $ifNull: ["$school.school_name", "General"] },
              status: 1,
              priority: { $toUpper: "$priority" },
              mode: { $cond: [{ $eq: ["$mode", 1] }, "Direct", "Chain"] },
              createdAt: 1,
            },
          },
        ]);

    const detailedRows = detailedRecords.map((r, idx) => ({
      "S.No": idx + 1,
      "Document ID": r.id,
      "Subject / Title": r.subject,
      "Category / Type": r.type || "General",
      "Applicant / Creator": r.emp_name,
      "Designation": r.designation,
      "Department": r.dept_name,
      "School": r.school_name,
      "Status": r.status,
      "Priority": r.priority || "NORMAL",
      "Mode": r.mode,
      ...(isApp ? { "Ref Notesheet": r.refNotesheet } : {}),
      "Date Created": r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-IN") : "—",
      "Time Created": r.createdAt ? new Date(r.createdAt).toLocaleTimeString("en-IN") : "—",
    }));

    if (format === "csv") {
      const ws = XLSX.utils.json_to_sheet(detailedRows);
      const csv = XLSX.utils.sheet_to_csv(ws);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="NoteQ_${isApp ? "Applications" : "Notesheets"}_Report_${dateStr}.csv"`
      );
      return res.status(200).send(csv);
    }

    // ── EXECUTIVE SUMMARY SHEET ──
    const summaryData = [
      { Metric: "Report Name", Value: `NoteQ Institutional ${isApp ? "Application" : "Notesheet"} Report` },
      { Metric: "Generated At", Value: new Date().toLocaleString("en-IN") },
      { Metric: "Access Scope", Value: scope.scopeLabel },
      { Metric: "Total Records Found", Value: detailedRecords.length },
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, "Overview");

    // ── DETAILED RECORDS SHEET ──
    const wsDetails = XLSX.utils.json_to_sheet(detailedRows);
    XLSX.utils.book_append_sheet(wb, wsDetails, isApp ? "Application Details" : "Notesheet Details");

    const excelBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="NoteQ_${isApp ? "Applications" : "Notesheets"}_Report_${dateStr}.xlsx"`
    );
    return res.status(200).send(excelBuffer);
  } catch (error) {
    console.error("exportReport error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to export report",
      error: error.message,
    });
  }
};

/**
 * Helper to format Turnaround Time in days or hours
 */
function formatTATDays(days) {
  if (days == null || isNaN(days) || days <= 0) return "—";
  if (days < 1) {
    const hours = Math.round(days * 24);
    return `${hours} hr${hours !== 1 ? "s" : ""}`;
  }
  return `${days.toFixed(1)} day${days.toFixed(1) !== "1.0" ? "s" : ""}`;
}

/**
 * Helper to serialize group key object to deterministic string
 */
function makeGroupKeyString(groupObj) {
  if (!groupObj) return "global";
  if (groupObj.dept_id != null && groupObj.period != null) {
    return `dept_${groupObj.dept_id}_${groupObj.period}`;
  }
  if (groupObj.dept_id != null) return `dept_${groupObj.dept_id}`;
  if (groupObj.emp_id != null) return `emp_${groupObj.emp_id}`;
  if (groupObj.period != null) return `period_${groupObj.period}`;
  return JSON.stringify(groupObj);
}
