import Holiday from "../models/leave/Holiday.model.js";
import LeaveType from "../models/leave/LeaveType.model.js";
import LeaveBalance from "../models/leave/LeaveBalance.model.js";

/**
 * Standard default leave types to seed
 */
let isLeaveTypesSeeded = false;

export async function seedInitialLeaveTypes() {
  if (isLeaveTypesSeeded) return;
  const count = await LeaveType.countDocuments();
  if (count > 0) {
    isLeaveTypesSeeded = true;
    return;
  }
  for (const lt of DEFAULT_LEAVE_TYPES) {
    await LeaveType.findOneAndUpdate(
      { leave_type_id: lt.leave_type_id },
      { $setOnInsert: lt },
      { upsert: true, returnDocument: "after" }
    );
  }
  isLeaveTypesSeeded = true;
}

let cachedLeaveTypes = null;
let cachedLeaveTypesTime = 0;

export async function getCachedActiveLeaveTypes() {
  if (cachedLeaveTypes && (Date.now() - cachedLeaveTypesTime < 600000)) {
    return cachedLeaveTypes;
  }
  await seedInitialLeaveTypes();
  cachedLeaveTypes = await LeaveType.find({ is_active: true }).sort({ leave_type_id: 1 }).lean();
  cachedLeaveTypesTime = Date.now();
  return cachedLeaveTypes;
}

export const DEFAULT_LEAVE_TYPES = [
  {
    leave_type_id: 1,
    code: "CL",
    name: "Casual Leave",
    annual_quota: 12,
    carry_forward_allowed: false,
    max_carry_forward_days: 0,
    allows_half_day: true,
    is_active: true,
  },
  {
    leave_type_id: 2,
    code: "SL",
    name: "Sick Leave",
    annual_quota: 10,
    carry_forward_allowed: true,
    max_carry_forward_days: 5,
    allows_half_day: false,
    is_active: true,
  },
  {
    leave_type_id: 3,
    code: "EL",
    name: "Earned Leave",
    annual_quota: 15,
    carry_forward_allowed: true,
    max_carry_forward_days: 30,
    allows_half_day: false,
    is_active: true,
  },
  {
    leave_type_id: 4,
    code: "OL",
    name: "Optional Leave",
    annual_quota: 3,
    carry_forward_allowed: false,
    max_carry_forward_days: 0,
    allows_half_day: false,
    is_active: true,
  },
];

/**
 * Calculate working leave days between from_date and to_date (inclusive),
 * excluding weekends (Saturday, Sunday) and Holidays for the school/academic year.
 */
export async function calculateLeaveDays(
  fromDateStr,
  toDateStr,
  durationType = "FULL_DAY",
  schoolId = 0,
  academicYear = ""
) {
  const fromDate = new Date(fromDateStr);
  const toDate = new Date(toDateStr);

  fromDate.setHours(0, 0, 0, 0);
  toDate.setHours(0, 0, 0, 0);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    throw new Error("Invalid date format provided for leave calculation");
  }

  if (fromDate > toDate) {
    throw new Error("from_date cannot be after to_date");
  }

  // Fetch holidays within date range for this school or all schools (0)
  const holidayQuery = {
    $or: [
      { holiday_date: { $gte: fromDate, $lte: toDate } },
      { from_date: { $lte: toDate }, to_date: { $gte: fromDate } },
    ],
    $and: [{ $or: [{ school_id: 0 }, { school_id: Number(schoolId) || 0 }] }],
  };
  if (academicYear) {
    holidayQuery.academicYear = academicYear;
  }

  const formatDateKey = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const holidays = await Holiday.find(holidayQuery).lean();
  const holidayDateSet = new Set();
  holidays.forEach((h) => {
    const hFrom = new Date(h.from_date || h.holiday_date);
    const hTo = new Date(h.to_date || h.holiday_date || hFrom);
    hFrom.setHours(0, 0, 0, 0);
    hTo.setHours(0, 0, 0, 0);

    const cur = new Date(hFrom);
    while (cur <= hTo) {
      holidayDateSet.add(formatDateKey(cur));
      cur.setDate(cur.getDate() + 1);
    }
  });

  let workingDaysCount = 0;
  let weekendDaysCount = 0;
  let holidayDaysCount = 0;
  let totalCalendarDays = 0;

  const current = new Date(fromDate);
  while (current <= toDate) {
    totalCalendarDays++;
    const dayOfWeek = current.getDay(); // 0 = Sunday, 6 = Saturday
    const dateKey = formatDateKey(current);

    if (dayOfWeek === 0 || dayOfWeek === 6) {
      weekendDaysCount++;
    } else if (holidayDateSet.has(dateKey)) {
      holidayDaysCount++;
    } else {
      workingDaysCount++;
    }

    current.setDate(current.getDate() + 1);
  }

  // Handle half-day duration
  let computedDays = workingDaysCount;
  if (durationType === "FIRST_HALF" || durationType === "SECOND_HALF") {
    if (totalCalendarDays === 1) {
      computedDays = workingDaysCount > 0 ? 0.5 : 0;
    } else {
      // If multiple days specified with half day, count last/first day as 0.5
      computedDays = Math.max(0, workingDaysCount > 0 ? workingDaysCount - 0.5 : 0);
    }
  }

  return {
    no_of_days: computedDays,
    breakdown: {
      totalCalendarDays,
      workingDaysCount,
      weekendDaysCount,
      holidayDaysCount,
      holidaysList: holidays.map((h) => ({
        name: h.name,
        date: h.holiday_date,
        type: h.type,
      })),
    },
  };
}

/**
 * Get or initialize LeaveBalance for an employee, leave type, and year (with optional role_id)
 * If roleId is provided, manages role-specific balance independently from base employee balance.
 */
export async function getOrInitLeaveBalance(empId, leaveTypeId, year = null, roleId = null) {
  const currentYear = year || new Date().getFullYear();
  const empNum = Number(empId);
  const typeNum = Number(leaveTypeId);
  const targetRoleId =
    roleId !== undefined && roleId !== null && roleId !== "" && !isNaN(roleId)
      ? Number(roleId)
      : null;

  let balance = await LeaveBalance.findOne({
    emp_id: empNum,
    role_id: targetRoleId,
    leave_type_id: typeNum,
    year: currentYear,
  });

  if (!balance) {
    // Look up LeaveType for quota
    const leaveType = await LeaveType.findOne({ leave_type_id: typeNum });
    let quota = leaveType ? leaveType.annual_quota : 10;

    // If initializing for a specific role, inherit base balance allocated_days if available
    if (targetRoleId !== null) {
      const baseBal = await LeaveBalance.findOne({
        emp_id: empNum,
        role_id: null,
        leave_type_id: typeNum,
        year: currentYear,
      }).lean();
      if (baseBal && typeof baseBal.allocated_days === "number") {
        quota = baseBal.allocated_days;
      }
    }

    balance = await LeaveBalance.create({
      emp_id: empNum,
      role_id: targetRoleId,
      leave_type_id: typeNum,
      year: currentYear,
      allocated_days: quota,
      used_days: 0,
      carried_forward_days: 0,
    });
  }

  return balance;
}

/**
 * Format balances array from an in-memory balanceMap without any DB queries.
 */
export function formatBalancesFromMap(leaveTypes, balanceMap, targetRoleId, currentYear) {
  const results = [];
  const normalizedRoleId =
    targetRoleId !== undefined && targetRoleId !== null && targetRoleId !== "" && !isNaN(targetRoleId)
      ? Number(targetRoleId)
      : null;

  for (const lt of leaveTypes) {
    let bal = null;
    let isRoleSpecific = false;

    if (normalizedRoleId !== null) {
      const roleBal = balanceMap.get(`${normalizedRoleId}_${lt.leave_type_id}`);
      if (roleBal) {
        bal = roleBal;
        isRoleSpecific = true;
      } else {
        bal = balanceMap.get(`base_${lt.leave_type_id}`);
        isRoleSpecific = false;
      }
    } else {
      bal = balanceMap.get(`base_${lt.leave_type_id}`);
      isRoleSpecific = false;
    }

    if (!bal) {
      bal = {
        allocated_days: lt.annual_quota || 0,
        used_days: 0,
        carried_forward_days: 0,
      };
    }

    const remaining = Math.max(
      0,
      (bal.allocated_days || 0) + (bal.carried_forward_days || 0) - (bal.used_days || 0)
    );

    results.push({
      leave_type_id: lt.leave_type_id,
      code: lt.code || lt.name.split(" ").map((w) => w[0]).join(""),
      name: lt.name,
      annual_quota: lt.annual_quota,
      allocated_days: bal.allocated_days ?? 0,
      used_days: bal.used_days ?? 0,
      carried_forward_days: bal.carried_forward_days ?? 0,
      remaining_days: remaining,
      year: currentYear,
      role_id: normalizedRoleId,
      is_role_specific: isRoleSpecific,
    });
  }

  return results;
}

/**
 * Get all leave balances for an employee in a given year.
 * If roleId is provided, returns role-specific balances where defined, falling back to base balances.
 */
export async function getAllEmployeeBalances(empId, year = null, roleId = null) {
  const currentYear = year || new Date().getFullYear();
  const empNum = Number(empId);
  const targetRoleId =
    roleId !== undefined && roleId !== null && roleId !== "" && !isNaN(roleId)
      ? Number(roleId)
      : null;

  // Use cached active leave types
  const leaveTypes = await getCachedActiveLeaveTypes();

  // Batch fetch all balances for this employee and year in ONE query
  const existingBalances = await LeaveBalance.find({
    emp_id: empNum,
    year: currentYear,
  }).lean();

  const balanceMap = new Map();
  existingBalances.forEach((b) => {
    const key = `${(b.role_id !== null && b.role_id !== undefined) ? b.role_id : "base"}_${b.leave_type_id}`;
    balanceMap.set(key, b);
  });

  // Check if any base balances are completely missing; batch initialize them in ONE write
  const missingBaseTypes = leaveTypes.filter((lt) => !balanceMap.has(`base_${lt.leave_type_id}`));
  if (missingBaseTypes.length > 0) {
    const docsToCreate = missingBaseTypes.map((lt) => ({
      emp_id: empNum,
      role_id: null,
      leave_type_id: lt.leave_type_id,
      year: currentYear,
      allocated_days: lt.annual_quota || 0,
      used_days: 0,
      carried_forward_days: 0,
    }));
    try {
      const created = await LeaveBalance.insertMany(docsToCreate, { ordered: false });
      created.forEach((b) => balanceMap.set(`base_${b.leave_type_id}`, b));
    } catch {
      // In case of parallel race condition or duplicate key, re-fetch
      const reloaded = await LeaveBalance.find({ emp_id: empNum, year: currentYear }).lean();
      reloaded.forEach((b) => {
        const key = `${(b.role_id !== null && b.role_id !== undefined) ? b.role_id : "base"}_${b.leave_type_id}`;
        balanceMap.set(key, b);
      });
    }
  }

  return formatBalancesFromMap(leaveTypes, balanceMap, targetRoleId, currentYear);
}

