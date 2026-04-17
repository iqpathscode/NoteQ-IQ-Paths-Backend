import Notesheet from "../models/notes/notesheet.model.js";
import NotesheetFlow from "../models/notes/notesheetFlow.model.js";
import Employee from "../models/user/employee.model.js";
import Role from "../models/userPowers/role.model.js";
import Department from "../models/office/department.model.js";
import School from "../models/office/school.model.js";
import archiver from "archiver";
import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";


const getApprovalFlowData = async (noteId) => {
  return await NotesheetFlow.aggregate([
    { $match: { note_id: Number(noteId) } },

    // ================= FROM EMPLOYEE =================
    {
      $lookup: {
        from: "employees",
        localField: "from_emp_id",
        foreignField: "emp_id",
        as: "fromEmployee",
      },
    },
    { $unwind: { path: "$fromEmployee", preserveNullAndEmptyArrays: true } },

    // ================= TO EMPLOYEE =================
    {
      $lookup: {
        from: "employees",
        localField: "to_emp_id",
        foreignField: "emp_id",
        as: "toEmployee",
      },
    },
    { $unwind: { path: "$toEmployee", preserveNullAndEmptyArrays: true } },

    // ================= ROLE LOOKUPS =================
    {
      $lookup: {
        from: "roles",
        localField: "to_role_id",
        foreignField: "role_id",
        as: "toRole",
      },
    },
    {
      $lookup: {
        from: "roles",
        localField: "from_role_id",
        foreignField: "role_id",
        as: "fromRole",
      },
    },

    { $unwind: { path: "$toRole", preserveNullAndEmptyArrays: true } },
    { $unwind: { path: "$fromRole", preserveNullAndEmptyArrays: true } },

    // ================= ROLE → EMPLOYEE (FIXED) =================
    {
  $lookup: {
    from: "employees",
    let: { roleId: "$to_role_id" },
    pipeline: [
      {
        $match: {
          $expr: { $in: ["$$roleId", "$role_ids"] },
        },
      },
      { $sort: { emp_id: 1 } },
      { $limit: 1 },
    ],
    as: "roleEmployee",
  },
},
{ $unwind: { path: "$roleEmployee", preserveNullAndEmptyArrays: true } },

    // ================= FINAL FIELDS =================
   {
  $addFields: {
    from_name: {
      $ifNull: [
        "$from_emp_name",
        "$fromEmployee.emp_name",
        "$fromRole.role_name",
      ],
    },

    to_name: {
      $ifNull: [
        "$to_emp_name",
        "$toEmployee.emp_name",
        "$roleEmployee.emp_name",
        "$toRole.role_name",
      ],
    },

    from_role_name: {
      $ifNull: [
        "$fromRole.role_name",
        "$fromEmployee.active_role_name",
      ],
    },

    to_role_name: {
      $ifNull: [
        "$toRole.role_name",
        "$roleEmployee.active_role_name",
      ],
    },
  },
},

    {
      $project: {
        action: 1,
        remark: 1,
        createdAt: 1,
        from_name: 1,
        to_name: 1,
        from_role_name: 1,
        to_role_name: 1,
      },
    },

    { $sort: { createdAt: 1 } },
  ]);
};
// ================= PDF =================
const generatePDFBuffer = async (noteId) => {
  return new Promise(async (resolve) => {
    try {
      const margin = 70;
      const doc = new PDFDocument({ margin });
      const buffers = [];

      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => resolve(Buffer.concat(buffers)));

      const notesheet = await Notesheet.findOne({ note_id: Number(noteId) });
      if (!notesheet) return resolve(null);

      // ================= CREATOR =================
      const creator = await Employee.findOne({
        emp_id: notesheet.created_by_emp_id,
      });

      const role = await Role.findOne({
        role_id: creator?.active_role_id,
      });

      const department = await Department.findOne({
        dept_id: creator?.dept_id,
      });

      const school = await School.findOne({
        school_id: creator?.school_id,
      });

      const flow = await getApprovalFlowData(noteId);

      const pageWidth = doc.page.width - margin * 2;

      // ================= HEADER =================
      const logoPath = path.join(process.cwd(), "src", "assets", "newLogo.png");

      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, margin, 40, { width: 100 });
      }

      doc.font("Helvetica-Bold").fontSize(16)
        .text("NOTESHEET", 0, 45, { align: "center" });

      doc.font("Helvetica").fontSize(10)
        .text(
          `Date: ${new Date(notesheet.createdAt).toLocaleString("en-IN")}`,
          margin,
          45,
          { align: "right" }
        );

      doc.moveDown(3);

      // ================= BASIC DETAILS =================
      doc.font("Helvetica-Bold").text("Basic Details:");
      doc.moveDown(0.5);

      doc.font("Helvetica");

      doc.text(`Created By: ${creator?.emp_name || "-"}`);
      doc.text(`Role: ${role?.role_name || "-"}`);
      doc.text(`Designation: ${creator?.designation || "-"}`);

      //  hide if null (important for higher authority)
      if (department?.dept_name) {
        doc.text(`Department: ${department.dept_name}`);
      }

      if (school?.school_name) {
        doc.text(`School: ${school.school_name}`);
      }

      doc.moveDown(0.5);

      doc.text(`Notesheet ID: ${notesheet.note_id}`);
      doc.text(`Status: ${notesheet.status}`);
      doc.text(
        `Created At: ${new Date(notesheet.createdAt).toLocaleString("en-IN")}`
      );

      doc.moveDown();

      // ================= SUBJECT =================
      doc.font("Helvetica-Bold")
        .text("Subject: ", { continued: true })
        .font("Helvetica")
        .text(notesheet.subject);

      doc.moveDown();

      // ================= DESCRIPTION =================
      doc.font("Helvetica-Bold").text("Description:");
      doc.moveDown(0.5);
      doc.font("Helvetica")
        .text(notesheet.description || "-", {
          width: pageWidth,
          align: "justify",
        });

      doc.moveDown();

      doc.text("The note is submitted for kind approval and necessary action.");

      doc.moveDown(2);

      // ================= APPROVAL FLOW =================
      doc.font("Helvetica-Bold").text("Approval Flow");
      doc.moveDown();

      if (flow.length === 0) {
        doc.text("No approval flow available");
      } else {
        flow.forEach((f, i) => {
          const fromName = f.from_name || "Unknown";
          const toName = f.to_name || "N/A";

          const fromRole = f.from_role_name || "-";
          const toRole = f.to_role_name || "-";

          const remarkText = Array.isArray(f.remark)
            ? f.remark.join(", ")
            : f.remark;

          //  MAIN LINE (FINAL FIXED FORMAT)
          doc.font("Helvetica-Bold")
            .text(
              `${i + 1}. ${fromName} (${fromRole}) → ${toName} (${toRole})`
            );

          doc.font("Helvetica")
            .text(
              `Action: ${f.action} | Date: ${new Date(
                f.createdAt
              ).toLocaleString("en-IN")}`
            );

          if (remarkText) {
            doc.text(`Remark: ${remarkText}`);
          }

          doc.moveDown();
        });
      }

      doc.moveDown(2);

      // ================= SIGNATURE =================
      const rightX = margin + pageWidth / 2;
      const lastFlow = flow.length ? flow[flow.length - 1] : null;

      doc.font("Helvetica-Bold")
        .text(
          lastFlow?.to_name || lastFlow?.to_role_name || "Pending",
          rightX,
          doc.y,
          { width: pageWidth / 2, align: "right" }
        );

      doc.font("Helvetica")
        .text(lastFlow?.to_role_name || "", {
          width: pageWidth / 2,
          align: "right",
        });

      doc.moveDown(2);

      // ================= ATTACHMENT =================
      doc.font("Helvetica-Bold")
        .text("Attachment:", rightX, doc.y, {
          width: pageWidth / 2,
          align: "right",
        });

      doc.moveDown(0.5);

      if (notesheet.attachment) {
        doc.fillColor("blue")
          .text("Click to view", {
            link: notesheet.attachment,
            underline: true,
            align: "right",
          });
        doc.fillColor("black");
      } else {
        doc.text("No attachment", { align: "right" });
      }

      doc.end();
    } catch (err) {
      console.error(err);
      resolve(null);
    }
  });
};

// ================= DOWNLOAD =================
export const downloadNotesheet = async (req, res) => {
  try {
    const pdfBuffer = await generatePDFBuffer(req.params.id);

    if (!pdfBuffer) return res.status(404).send("Not found");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=notesheet_${req.params.id}.pdf`
    );

    res.send(pdfBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

// ================= BULK =================
export const bulkDownload = async (req, res) => {
  try {
    const { ids } = req.body;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=notesheets.zip"
    );

    const archive = archiver("zip");
    archive.pipe(res);

    for (const id of ids) {
      const pdfBuffer = await generatePDFBuffer(id);

      if (pdfBuffer) {
        archive.append(pdfBuffer, {
          name: `notesheet_${id}.pdf`,
        });
      }
    }

    archive.finalize();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};
