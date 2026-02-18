import Notesheet from "../models/notes/notesheet.model.js";
import Employee from "../models/user/employee.model.js";

const notesheetViewPipeline = (matchStage = null) => {
  const pipeline = [];

  if (matchStage) {
    pipeline.push(matchStage);
  }

  pipeline.push(
    {
      $lookup: {
        from: Employee.collection.name,
        localField: "emp_id",
        foreignField: "emp_id",
        as: "sender"
      }
    },
    {
      $lookup: {
        from: Employee.collection.name,
        localField: "forward_to",
        foreignField: "emp_id",
        as: "receiver"
      }
    },
    {
      $addFields: {
        submittedBy: { $arrayElemAt: ["$sender.emp_name", 0] },
        submittedTo: { $arrayElemAt: ["$receiver.emp_name", 0] }
      }
    },
    {
      $project: {
        _id: 0,
        id: { $toString: "$note_id" },
        note_id: 1,
        title: "$subject",
        date: "$createdAt",
        status: 1,
        description: 1,
        attachments: {
          $cond: [{ $ifNull: ["$attachment", false] }, ["$attachment"], []]
        },
        submittedBy: 1,
        submittedTo: 1,
        category: { $literal: null },
        priority: { $literal: null },
        emp_id: 1,
        dept_id: 1,
        forward_to: 1
      }
    }
  );

  return pipeline;
};

export const getNotesheetsForEmployee = async (req, res) => {
  try {
    const empId = Number(req.query.empId);

    if (!empId) {
      return res.status(400).json({
        success: false,
        message: "empId query param is required"
      });
    }

    const notesheets = await Notesheet.aggregate(
      notesheetViewPipeline({ $match: { emp_id: empId } })
    );

    return res.status(200).json({
      success: true,
      message: "Notesheets fetched successfully",
      data: notesheets
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

export const getNotesheetById = async (req, res) => {
  try {
    const noteId = Number(req.params.noteId);

    if (!noteId) {
      return res.status(400).json({
        success: false,
        message: "noteId is required"
      });
    }

    const results = await Notesheet.aggregate(
      notesheetViewPipeline({ $match: { note_id: noteId } })
    );

    const notesheet = results[0];

    if (!notesheet) {
      return res.status(404).json({
        success: false,
        message: "Notesheet not found"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Notesheet fetched successfully",
      data: notesheet
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};
