import Holiday from "../models/leave/Holiday.model.js";
import LeaveType from "../models/leave/LeaveType.model.js";
import LeaveBalance from "../models/leave/LeaveBalance.model.js";

/**
 * Standard default leave types to seed
 */
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
 * Seed initial leave types if not already seeded
 */
export async function seedInitialLeaveTypes() {
  for (const lt of DEFAULT_LEAVE_TYPES) {
    await LeaveType.findOneAndUpdate(
      { leave_type_id: lt.leave_type_id },
      { $setOnInsert: lt },
      { upsert: true, returnDocument: "after" }
    );
  }
}

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

  // Ensure leave types exist
  await seedInitialLeaveTypes();
  const leaveTypes = await LeaveType.find({ is_active: true }).sort({ leave_type_id: 1 }).lean();

  const results = [];
  for (const lt of leaveTypes) {
    let bal = null;
    let isRoleSpecific = false;

    if (targetRoleId !== null) {
      // Check for specific role balance
      const roleBal = await LeaveBalance.findOne({
        emp_id: empNum,
        role_id: targetRoleId,
        leave_type_id: lt.leave_type_id,
        year: currentYear,
      });

      if (roleBal) {
        bal = roleBal;
        isRoleSpecific = true;
      } else {
        // Fall back to base balance
        bal = await getOrInitLeaveBalance(empNum, lt.leave_type_id, currentYear, null);
        isRoleSpecific = false;
      }
    } else {
      bal = await getOrInitLeaveBalance(empNum, lt.leave_type_id, currentYear, null);
      isRoleSpecific = false;
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
      allocated_days: bal.allocated_days,
      used_days: bal.used_days,
      carried_forward_days: bal.carried_forward_days,
      remaining_days: remaining,
      year: currentYear,
      role_id: targetRoleId,
      is_role_specific: isRoleSpecific,
    });
  }

  return results;
}

