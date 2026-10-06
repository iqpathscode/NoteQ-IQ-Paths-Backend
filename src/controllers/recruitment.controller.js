import JobOpening from "../models/recruitment/JobOpening.model.js";
import JobApplication from "../models/recruitment/JobApplication.model.js";
import InterviewEvaluation from "../models/recruitment/InterviewEvaluation.model.js";
import Employee from "../models/user/employee.model.js";
import Department from "../models/office/department.model.js";
import bcrypt from "bcryptjs";

// ======================== UGC 2018 SCORING ENGINE ========================
const calculateUgcApiScore = (applicationData) => {
  let gradScore = 0;
  let pgScore = 0;
  let mphilScore = 0;
  let phdScore = 0;
  let netScore = 0;
  let pubScore = 0;
  let expScore = 0;

  const academics = applicationData.academics || [];

  // Graduation
  const bachelors = academics.find((a) => a.level === "BACHELORS");
  if (bachelors?.percentage_or_cgpa) {
    const p = Number(bachelors.percentage_or_cgpa);
    if (p >= 80) gradScore = 15;
    else if (p >= 60) gradScore = 13;
    else if (p >= 55) gradScore = 10;
    else if (p >= 45) gradScore = 5;
  }

  // Post Graduation
  const masters = academics.find((a) => a.level === "MASTERS");
  if (masters?.percentage_or_cgpa) {
    const p = Number(masters.percentage_or_cgpa);
    if (p >= 80) pgScore = 25;
    else if (p >= 60) pgScore = 23;
    else if (p >= 55) pgScore = 20;
    else if (p >= 50 && applicationData.category !== "GENERAL") pgScore = 20;
  }

  // M.Phil
  const mphil = academics.find((a) => a.level === "MPHIL");
  if (mphil?.percentage_or_cgpa) {
    const p = Number(mphil.percentage_or_cgpa);
    if (p >= 60) mphilScore = 7;
    else if (p >= 55) mphilScore = 5;
  }

  // Ph.D.
  const phd = academics.find((a) => a.level === "PHD");
  if (phd) {
    phdScore = 30;
  }

  // Combined cap for M.Phil + Ph.D. = max 30
  if (mphilScore + phdScore > 30) {
    mphilScore = Math.max(0, 30 - phdScore);
  }

  // National Eligibility
  const nat = applicationData.national_eligibility || {};
  if (nat.net_jrf) {
    netScore = 7;
  } else if (nat.net_qualified) {
    netScore = 5;
  } else if (nat.slet_qualified) {
    netScore = 3;
  }

  // Combined cap for JRF/NET/SET = max 7
  netScore = Math.min(netScore, 7);

  // Publications (2 marks each, max 10)
  const pubs = applicationData.publications || [];
  const validPubs = pubs.filter((p) => p.is_scopus || p.is_ugc_care || p.issn);
  pubScore = Math.min(validPubs.length * 2, 10);

  // Teaching / Post-Doctoral Experience (2 marks for 1 year, max 10)
  const exps = applicationData.experience || [];
  let totalMonths = 0;
  exps.forEach((e) => {
    if (e.months) totalMonths += Number(e.months);
    else if (e.start_date && e.end_date) {
      const start = new Date(e.start_date);
      const end = new Date(e.end_date);
      const m = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
      totalMonths += Math.max(0, m);
    }
  });
  const totalYears = Math.floor(totalMonths / 12);
  expScore = Math.min(totalYears * 2, 10);

  const total = gradScore + pgScore + mphilScore + phdScore + netScore + pubScore + expScore;

  return {
    graduation_score: gradScore,
    post_graduation_score: pgScore,
    mphil_score: mphilScore,
    phd_score: phdScore,
    net_score: netScore,
    publications_score: pubScore,
    experience_score: expScore,
    awards_score: 0,
    total_score: Math.min(total, 100),
    ai_calculated: true,
  };
};

// ======================== PUBLIC RECRUITMENT APIS ========================

// GET /api/recruitment/jobs (Public listing of active job openings)
export const getPublicJobs = async (req, res) => {
  try {
    const { dept_id, designation, roster_category } = req.query;
    const filter = { status: "ACTIVE", end_date: { $gte: new Date() } };

    if (dept_id) filter.dept_id = Number(dept_id);
    if (designation) filter.designation = designation;
    if (roster_category) filter.roster_category = roster_category;

    const jobs = await JobOpening.find(filter).sort({ createdAt: -1 }).lean();
    return res.status(200).json({ success: true, count: jobs.length, data: jobs });
  } catch (err) {
    console.error("getPublicJobs error:", err);
    return res.status(500).json({ success: false, message: "Error fetching jobs", error: err.message });
  }
};

// GET /api/recruitment/jobs/:jobId (Public details of a specific job)
export const getPublicJobById = async (req, res) => {
  try {
    const job = await JobOpening.findOne({ job_id: Number(req.params.jobId) }).lean();
    if (!job) {
      return res.status(404).json({ success: false, message: "Job opening not found" });
    }
    return res.status(200).json({ success: true, data: job });
  } catch (err) {
    console.error("getPublicJobById error:", err);
    return res.status(500).json({ success: false, message: "Error fetching job details", error: err.message });
  }
};

// POST /api/recruitment/apply (Public candidate application submission)
export const applyForJob = async (req, res) => {
  try {
    const { job_id, full_name, email, phone, dob } = req.body;

    if (!job_id || !full_name || !email || !phone || !dob) {
      return res.status(400).json({
        success: false,
        message: "Mandatory fields missing: job_id, full_name, email, phone, and dob are required",
      });
    }

    const job = await JobOpening.findOne({ job_id: Number(job_id) });
    if (!job || job.status !== "ACTIVE") {
      return res.status(400).json({
        success: false,
        message: "This job opening is not currently accepting applications",
      });
    }

    // Check duplicate application
    const existing = await JobApplication.findOne({
      job_id: Number(job_id),
      $or: [{ email: email.toLowerCase() }, { phone: phone.trim() }],
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `An application already exists for this job with Application No: ${existing.application_no}`,
      });
    }

    // Calculate baseline UGC API Score automatically
    const apiScore = calculateUgcApiScore(req.body);

    const application = new JobApplication({
      ...req.body,
      job_id: Number(job_id),
      api_score_breakdown: apiScore,
      status: "SUBMITTED",
    });

    await application.save();

    return res.status(201).json({
      success: true,
      message: "Application submitted successfully",
      data: {
        application_no: application.application_no,
        full_name: application.full_name,
        job_id: application.job_id,
        api_score: application.api_score_breakdown.total_score,
        status: application.status,
      },
    });
  } catch (err) {
    console.error("applyForJob error:", err);
    return res.status(500).json({ success: false, message: "Application submission failed", error: err.message });
  }
};

// GET /api/recruitment/track/:appNo (Track application status)
export const trackApplication = async (req, res) => {
  try {
    const { appNo } = req.params;
    const { phone } = req.query;

    const query = { application_no: appNo };
    if (phone) query.phone = phone.trim();

    const application = await JobApplication.findOne(query)
      .select("application_no full_name job_id status interview_details createdAt api_score_breakdown.total_score")
      .lean();

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found with provided credentials",
      });
    }

    const job = await JobOpening.findOne({ job_id: application.job_id })
      .select("title dept_name designation advertisement_no")
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        ...application,
        job_details: job,
      },
    });
  } catch (err) {
    console.error("trackApplication error:", err);
    return res.status(500).json({ success: false, message: "Error tracking application", error: err.message });
  }
};

// ======================== ADMIN RECRUITMENT APIS ========================

// POST /api/recruitment/admin/jobs (Create new job opening)
export const createJobOpening = async (req, res) => {
  try {
    const { advertisement_no, title, dept_id, designation, end_date } = req.body;

    if (!advertisement_no || !title || !dept_id || !designation || !end_date) {
      return res.status(400).json({
        success: false,
        message: "advertisement_no, title, dept_id, designation, and end_date are required",
      });
    }

    const dept = await Department.findOne({ dept_id: Number(dept_id) }).lean();
    if (!dept) {
      return res.status(404).json({ success: false, message: "Department not found" });
    }

    const job = new JobOpening({
      ...req.body,
      dept_id: Number(dept_id),
      dept_name: dept.dept_name,
      school_name: dept.school_name || "",
      created_by_admin: req.user?.email || "Admin",
    });

    await job.save();
    return res.status(201).json({ success: true, message: "Job opening created", data: job });
  } catch (err) {
    console.error("createJobOpening error:", err);
    return res.status(500).json({ success: false, message: "Failed to create job opening", error: err.message });
  }
};

// GET /api/recruitment/admin/jobs (List all jobs with candidate counts)
export const getAllJobsAdmin = async (req, res) => {
  try {
    const jobs = await JobOpening.find().sort({ createdAt: -1 }).lean();

    // Attach application counts
    const jobsWithStats = await Promise.all(
      jobs.map(async (job) => {
        const total = await JobApplication.countDocuments({ job_id: job.job_id });
        const eligible = await JobApplication.countDocuments({ job_id: job.job_id, status: { $in: ["ELIGIBLE", "SHORTLISTED", "INTERVIEW_SCHEDULED", "SELECTED"] } });
        return {
          ...job,
          total_applications: total,
          eligible_applications: eligible,
        };
      })
    );

    return res.status(200).json({ success: true, data: jobsWithStats });
  } catch (err) {
    console.error("getAllJobsAdmin error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch jobs", error: err.message });
  }
};

// PUT /api/recruitment/admin/jobs/:jobId (Update job status or details)
export const updateJobOpening = async (req, res) => {
  try {
    const job = await JobOpening.findOneAndUpdate(
      { job_id: Number(req.params.jobId) },
      { $set: req.body },
      { new: true }
    );
    if (!job) {
      return res.status(404).json({ success: false, message: "Job opening not found" });
    }
    return res.status(200).json({ success: true, message: "Job opening updated", data: job });
  } catch (err) {
    console.error("updateJobOpening error:", err);
    return res.status(500).json({ success: false, message: "Failed to update job opening", error: err.message });
  }
};

// GET /api/recruitment/admin/applications (List candidates for a job with filtering)
export const getApplicationsForJob = async (req, res) => {
  try {
    const { job_id, status, min_score, sort_by } = req.query;
    const filter = {};

    if (job_id) filter.job_id = Number(job_id);
    if (status) filter.status = status;
    if (min_score) filter["api_score_breakdown.total_score"] = { $gte: Number(min_score) };

    let query = JobApplication.find(filter);

    if (sort_by === "api_score") {
      query = query.sort({ "api_score_breakdown.total_score": -1 });
    } else {
      query = query.sort({ createdAt: -1 });
    }

    const applications = await query.lean();
    return res.status(200).json({ success: true, count: applications.length, data: applications });
  } catch (err) {
    console.error("getApplicationsForJob error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch applications", error: err.message });
  }
};

// PATCH /api/recruitment/admin/applications/:id/scrutiny (Update scrutiny classification)
export const updateApplicationScrutiny = async (req, res) => {
  try {
    const { status, scrutiny_remarks, ineligible_reason, override_score } = req.body;

    const app = await JobApplication.findById(req.params.id);
    if (!app) {
      return res.status(404).json({ success: false, message: "Application not found" });
    }

    if (status) app.status = status;
    if (scrutiny_remarks !== undefined) app.scrutiny_remarks = scrutiny_remarks;
    if (ineligible_reason !== undefined) app.ineligible_reason = ineligible_reason;

    if (override_score !== undefined && app.api_score_breakdown) {
      app.api_score_breakdown.total_score = Number(override_score);
    }

    await app.save();
    return res.status(200).json({ success: true, message: "Scrutiny decision updated", data: app });
  } catch (err) {
    console.error("updateApplicationScrutiny error:", err);
    return res.status(500).json({ success: false, message: "Failed to update scrutiny", error: err.message });
  }
};

// POST /api/recruitment/admin/applications/:id/schedule-interview
export const scheduleInterview = async (req, res) => {
  try {
    const { date, time, venue, meeting_link } = req.body;
    const app = await JobApplication.findById(req.params.id);
    if (!app) {
      return res.status(404).json({ success: false, message: "Application not found" });
    }

    app.interview_details = {
      date: new Date(date),
      time: time || "",
      venue: venue || "",
      meeting_link: meeting_link || "",
      call_letter_sent: true,
    };
    app.status = "INTERVIEW_SCHEDULED";
    await app.save();

    return res.status(200).json({
      success: true,
      message: "Interview scheduled successfully and marked on candidate file",
      data: app,
    });
  } catch (err) {
    console.error("scheduleInterview error:", err);
    return res.status(500).json({ success: false, message: "Failed to schedule interview", error: err.message });
  }
};

// POST /api/recruitment/admin/evaluations (Submit panelist evaluation scores)
export const submitPanelEvaluation = async (req, res) => {
  try {
    const { application_id, panelist_name, panelist_role, scores, remarks, recommendation } = req.body;

    if (!application_id || !panelist_name || !scores) {
      return res.status(400).json({
        success: false,
        message: "application_id, panelist_name, and scores are required",
      });
    }

    const app = await JobApplication.findById(application_id);
    if (!app) {
      return res.status(404).json({ success: false, message: "Application not found" });
    }

    const evaluation = new InterviewEvaluation({
      application_id: app._id,
      application_no: app.application_no,
      job_id: app.job_id,
      candidate_name: app.full_name,
      panelist_name,
      panelist_role: panelist_role || "MEMBER",
      scores,
      remarks: remarks || "",
      recommendation: recommendation || "RECOMMENDED",
    });

    await evaluation.save();
    return res.status(201).json({ success: true, message: "Evaluation recorded", data: evaluation });
  } catch (err) {
    console.error("submitPanelEvaluation error:", err);
    return res.status(500).json({ success: false, message: "Failed to submit evaluation", error: err.message });
  }
};

// GET /api/recruitment/admin/jobs/:jobId/merit-list (Aggregated merit list)
export const getJobMeritList = async (req, res) => {
  try {
    const jobId = Number(req.params.jobId);
    const applications = await JobApplication.find({
      job_id: jobId,
      status: { $in: ["INTERVIEW_SCHEDULED", "SELECTED", "REJECTED", "ONBOARDED"] },
    }).lean();

    const evaluations = await InterviewEvaluation.find({ job_id: jobId }).lean();

    const meritList = applications.map((app) => {
      const candidateEvals = evaluations.filter((e) => String(e.application_id) === String(app._id));
      const avgScore =
        candidateEvals.length > 0
          ? candidateEvals.reduce((acc, curr) => acc + (curr.scores?.total || 0), 0) / candidateEvals.length
          : 0;

      return {
        application_id: app._id,
        application_no: app.application_no,
        full_name: app.full_name,
        category: app.category,
        api_score: app.api_score_breakdown?.total_score || 0,
        interview_score_avg: Number(avgScore.toFixed(2)),
        combined_merit_score: Number(((app.api_score_breakdown?.total_score || 0) * 0.5 + avgScore * 0.5).toFixed(2)),
        evaluations_count: candidateEvals.length,
        status: app.status,
      };
    });

    meritList.sort((a, b) => b.combined_merit_score - a.combined_merit_score);

    return res.status(200).json({ success: true, count: meritList.length, data: meritList });
  } catch (err) {
    console.error("getJobMeritList error:", err);
    return res.status(500).json({ success: false, message: "Failed to generate merit list", error: err.message });
  }
};

// POST /api/recruitment/admin/applications/:id/onboard (THE 1-CLICK EMPLOYEE BRIDGE)
export const onboardCandidate = async (req, res) => {
  try {
    const app = await JobApplication.findById(req.params.id);
    if (!app) {
      return res.status(404).json({ success: false, message: "Application not found" });
    }

    if (app.status === "ONBOARDED" && app.onboarded_emp_id) {
      return res.status(400).json({
        success: false,
        message: `Candidate has already been onboarded as Employee #${app.onboarded_emp_id}`,
      });
    }

    const job = await JobOpening.findOne({ job_id: app.job_id }).lean();
    if (!job) {
      return res.status(404).json({ success: false, message: "Associated job opening not found" });
    }

    // Check if employee with same email or mobile already exists
    const duplicateEmp = await Employee.findOne({
      $or: [{ email: app.email.toLowerCase() }, { mobile_number: app.phone }],
    }).lean();
    if (duplicateEmp) {
      return res.status(400).json({
        success: false,
        message: `An employee with this email or mobile number already exists (Emp ID: ${duplicateEmp.emp_id})`,
      });
    }

    // Generate unique emp_id using Counter or find max
    const lastEmp = await Employee.findOne().sort({ emp_id: -1 }).lean();
    const newEmpId = lastEmp && lastEmp.emp_id ? lastEmp.emp_id + 1 : 1001;

    // Default password (e.g. Employee@123)
    const defaultPasswordPlain = "Employee@123";
    const hashedPassword = await bcrypt.hash(defaultPasswordPlain, 10);

    const newEmployee = new Employee({
      emp_id: newEmpId,
      emp_name: app.full_name,
      designation: job.designation,
      mobile_number: app.phone,
      email: app.email.toLowerCase(),
      password: hashedPassword,
      dept_id: job.dept_id,
      school_id: job.dept_id, // Default or mapped
      role_ids: [],
      is_active: true,
      isDefaultPassword: true,
    });

    await newEmployee.save();

    // Mark candidate as ONBOARDED
    app.status = "ONBOARDED";
    app.onboarded_emp_id = newEmpId;
    app.onboarded_at = new Date();
    await app.save();

    return res.status(201).json({
      success: true,
      message: `Candidate successfully onboarded into NoteQ as Employee #${newEmpId}`,
      data: {
        emp_id: newEmployee.emp_id,
        emp_name: newEmployee.emp_name,
        designation: newEmployee.designation,
        email: newEmployee.email,
        dept_id: newEmployee.dept_id,
        isDefaultPassword: newEmployee.isDefaultPassword,
      },
    });
  } catch (err) {
    console.error("onboardCandidate error:", err);
    return res.status(500).json({ success: false, message: "Onboarding failed", error: err.message });
  }
};
