import Holiday from "../models/leave/Holiday.model.js";
import { Counter } from "../models/counter/counter.model.js";

/**
 * GET /api/holidays
 * Fetch holidays for calendar and dropdowns
 */
export const getHolidays = async (req, res) => {
  try {
    const { year, academic_year, school_id, type } = req.query;
    const andConditions = [];

    if (academic_year) {
      andConditions.push({ academic_year });
    } else if (year) {
      const y = Number(year);
      const startOfYear = new Date(y, 0, 1);
      const endOfYear = new Date(y, 11, 31, 23, 59, 59);
      andConditions.push({
        $or: [
          { holiday_date: { $gte: startOfYear, $lte: endOfYear } },
          { from_date: { $gte: startOfYear, $lte: endOfYear } },
          { to_date: { $gte: startOfYear, $lte: endOfYear } },
          { from_date: { $lte: startOfYear }, to_date: { $gte: endOfYear } },
        ],
      });
    }

    if (school_id !== undefined && school_id !== "") {
      andConditions.push({
        $or: [{ school_id: 0 }, { school_id: Number(school_id) }],
      });
    }

    if (type) {
      andConditions.push({ type: String(type).toUpperCase() });
    }

    const filter = andConditions.length > 0 ? { $and: andConditions } : {};
    const holidays = await Holiday.find(filter).sort({ holiday_date: 1, from_date: 1 }).lean();

    return res.status(200).json({
      success: true,
      data: holidays,
      count: holidays.length,
    });
  } catch (error) {
    console.error("getHolidays error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch holidays",
      error: error.message,
    });
  }
};

/**
 * POST /api/holidays
 * Create a new holiday entry (HR / Admin) - supports single date or from_date to to_date range
 */
export const createHoliday = async (req, res) => {
  try {
    const {
      name,
      holiday_date,
      from_date,
      to_date,
      type,
      academic_year,
      school_id = 0,
      dept_id = 0,
    } = req.body;

    const effFromDate = from_date || holiday_date;
    const effToDate = to_date || effFromDate;

    if (!name || !effFromDate || !type) {
      return res.status(400).json({
        success: false,
        message: "name, from_date (or holiday_date), and type (PUBLIC/OPTIONAL/COMPANY) are required.",
      });
    }

    const fromDateObj = new Date(effFromDate);
    const toDateObj = new Date(effToDate);
    fromDateObj.setHours(0, 0, 0, 0);
    toDateObj.setHours(0, 0, 0, 0);

    if (isNaN(fromDateObj.getTime()) || isNaN(toDateObj.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format provided for holiday.",
      });
    }

    if (fromDateObj > toDateObj) {
      return res.status(400).json({
        success: false,
        message: "from_date cannot be after to_date.",
      });
    }

    // Calculate number of calendar days (inclusive)
    const diffTime = Math.abs(toDateObj.getTime() - fromDateObj.getTime());
    const noOfDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;

    const counter = await Counter.findOneAndUpdate(
      { name: "holiday_id" },
      { $inc: { seq: 1 } },
      { returnDocument: "after", upsert: true }
    );

    const yr = fromDateObj.getFullYear();
    const defaultAcadYear = academic_year || `${yr}-${yr + 1}`;

    const holiday = await Holiday.create({
      holiday_id: counter.seq,
      name: name.trim(),
      holiday_date: fromDateObj,
      from_date: fromDateObj,
      to_date: toDateObj,
      no_of_days: noOfDays,
      type: String(type).toUpperCase(),
      academic_year: defaultAcadYear,
      school_id: Number(school_id) || 0,
      dept_id: Number(dept_id) || 0,
      created_by_emp_id: req.user?.emp_id ? Number(req.user.emp_id) : 1,
    });

    return res.status(201).json({
      success: true,
      message: "Holiday created successfully",
      data: holiday,
    });
  } catch (error) {
    console.error("createHoliday error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create holiday",
      error: error.message,
    });
  }
};

/**
 * PATCH /api/holidays/:id
 * Update holiday details
 */
export const updateHoliday = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      holiday_date,
      from_date,
      to_date,
      type,
      academic_year,
      school_id,
      dept_id,
    } = req.body;

    const query = isNaN(Number(id)) ? { _id: id } : { holiday_id: Number(id) };
    const existing = await Holiday.findOne(query);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Holiday not found" });
    }

    const updateFields = {};
    if (name) updateFields.name = name.trim();
    if (type) updateFields.type = String(type).toUpperCase();
    if (academic_year) updateFields.academic_year = academic_year;
    if (school_id !== undefined) updateFields.school_id = Number(school_id);
    if (dept_id !== undefined) updateFields.dept_id = Number(dept_id);

    const effFromDate = from_date || holiday_date || (existing.from_date || existing.holiday_date);
    const effToDate = to_date || (from_date ? effFromDate : (existing.to_date || existing.holiday_date));

    if (from_date || to_date || holiday_date) {
      const fromDateObj = new Date(effFromDate);
      const toDateObj = new Date(effToDate);
      fromDateObj.setHours(0, 0, 0, 0);
      toDateObj.setHours(0, 0, 0, 0);

      if (fromDateObj > toDateObj) {
        return res.status(400).json({
          success: false,
          message: "from_date cannot be after to_date.",
        });
      }

      const diffTime = Math.abs(toDateObj.getTime() - fromDateObj.getTime());
      const noOfDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;

      updateFields.holiday_date = fromDateObj;
      updateFields.from_date = fromDateObj;
      updateFields.to_date = toDateObj;
      updateFields.no_of_days = noOfDays;
    }

    const updated = await Holiday.findOneAndUpdate(query, { $set: updateFields }, { returnDocument: "after" });

    return res.status(200).json({
      success: true,
      message: "Holiday updated successfully",
      data: updated,
    });
  } catch (error) {
    console.error("updateHoliday error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update holiday",
      error: error.message,
    });
  }
};

/**
 * DELETE /api/holidays/:id
 * Delete holiday
 */
export const deleteHoliday = async (req, res) => {
  try {
    const { id } = req.params;
    const query = isNaN(Number(id)) ? { _id: id } : { holiday_id: Number(id) };

    const deleted = await Holiday.findOneAndDelete(query);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Holiday not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Holiday deleted successfully",
    });
  } catch (error) {
    console.error("deleteHoliday error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete holiday",
      error: error.message,
    });
  }
};
