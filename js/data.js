// ══════════════════════════════════════════════
//  SAMARTHAA HOSPITAL — ICU Ward 6A
//  VitalWatch v2.4.1
// ══════════════════════════════════════════════

const HOSPITAL = {
  name:    'Samarthaa Hospital',
  ward:    'ICU — Ward 6A',
  address: 'Samarthaa Hospital, Ward 6A'
};

// ── Care Team (Real Contacts) ──
const STAKEHOLDERS = [
  {
    id: 'S001',
    name: 'Dr. Mahesh KM',
    initials: 'MK',
    role: 'Intensivist · Ward 6A',
    specialty: 'Critical Care',
    status: 'oncall',
    alertPriority: 1,
    phone: '+919741605315',
    phoneDisplay: '+919741605315',
    whatsapp: '+919741605315',
    email: 'dr.mahesh@samarthaa.in',
    color: 'rgba(0,212,170,0.15)',
    textColor: '#00d4aa'
  },
  {
    id: 'S002',
    name: 'Dr. Nagendra Prasad',
    initials: 'NP',
    role: 'Cardiologist',
    specialty: 'Cardiology',
    status: 'available',
    alertPriority: 2,
    phone: '+919886428892',
    phoneDisplay: '+919886428892',
    whatsapp: '+919886428892',
    email: 'dr.nagendra@samarthaa.in',
    color: 'rgba(59,130,246,0.15)',
    textColor: '#3b82f6'
  },
  {
    id: 'S003',
    name: 'Dr. Rekha Jayaram',
    initials: 'RJ',
    role: 'Physician',
    specialty: 'General Medicine',
    status: 'available',
    alertPriority: 3,
    phone: '+919741605315',
    phoneDisplay: '+919741605315',
    whatsapp: '+919741605315',
    email: 'dr.rekha@samarthaa.in',
    color: 'rgba(167,139,250,0.15)',
    textColor: '#a78bfa'
  },
  {
    id: 'S004',
    name: 'Nurse Asha',
    initials: 'AS',
    role: 'Shift Nurse · Ward 6A',
    specialty: 'ICU Nursing',
    status: 'oncall',
    alertPriority: 2,
    phone: '+919632288745',
    phoneDisplay: '+919632288745',
    whatsapp: '+919632288745',
    email: 'nurse.asha@samarthaa.in',
    color: 'rgba(245,158,11,0.15)',
    textColor: '#f59e0b'
  },
  {
    id: 'S005',
    name: 'Govardhanswamy GN',
    initials: 'GG',
    role: 'Hospital Admin',
    specialty: 'Administration',
    status: 'available',
    alertPriority: 5,
    phone: '+919632288745',
    phoneDisplay: '+919632288745',
    whatsapp: '+919632288745',
    email: 'admin@samarthaa.in',
    color: 'rgba(139,149,176,0.15)',
    textColor: '#8b95b0'
  }
];

// ── Alert Routing ──
// Defines who gets called/messaged for each alert level
const ALERT_ROUTING = {
  critical: {
    call:     ['S001', 'S004'],               // Phone call: Dr. Mahesh + Nurse Asha
    whatsapp: ['S001', 'S002', 'S004'],       // WhatsApp: + Dr. Nagendra
    sms:      ['S001', 'S002', 'S003', 'S004']// SMS: all doctors + nurse
  },
  warning: {
    call:     [],                              // No call for warnings
    whatsapp: ['S001', 'S004'],               // Dr. Mahesh + Nurse Asha
    sms:      ['S001', 'S004']
  },
  report: {
    whatsapp: ['S001', 'S002', 'S003', 'S004', 'S005'], // All staff
    email:    ['S001', 'S002', 'S003', 'S004', 'S005']
  }
};

// ── Patient Data ──
const PATIENTS = [
  {
    id: 'P001', name: 'Ramesh Kumar', age: 62, sex: 'Male', bed: 'Bed 01',
    dx: 'Post-CABG Day 2', admitted: 'Apr 8, 2026', doctor: 'Dr. Mahesh KM',
    vitals: { hr: 78, bps: 118, bpd: 76, spo2: 98, temp: 37.1, rr: 16, etco2: 38 },
    alerts: []
  },
  {
    id: 'P002', name: 'Priya Sharma', age: 45, sex: 'Female', bed: 'Bed 02',
    dx: 'Septic Shock Day 3', admitted: 'Apr 7, 2026', doctor: 'Dr. Mahesh KM',
    vitals: { hr: 108, bps: 96, bpd: 62, spo2: 93, temp: 38.7, rr: 24, etco2: 42 },
    alerts: [
      { time: '08:14', level: 'warning', msg: 'SpO₂ dropped to 91%' },
      { time: '06:32', level: 'critical', msg: 'BP fell to 82/50 mmHg' }
    ]
  },
  {
    id: 'P003', name: 'Anwar Khan', age: 71, sex: 'Male', bed: 'Bed 03',
    dx: 'ARDS Day 5', admitted: 'Apr 5, 2026', doctor: 'Dr. Nagendra Prasad',
    vitals: { hr: 91, bps: 104, bpd: 68, spo2: 91, temp: 37.9, rr: 29, etco2: 51 },
    alerts: [
      { time: '10:05', level: 'critical', msg: 'SpO₂ critically low: 88%' },
      { time: '07:20', level: 'warning', msg: 'Elevated RR: 26/min' }
    ]
  },
  {
    id: 'P004', name: 'Leela Nair', age: 54, sex: 'Female', bed: 'Bed 04',
    dx: 'DKA Day 1', admitted: 'Apr 10, 2026', doctor: 'Dr. Rekha Jayaram',
    vitals: { hr: 94, bps: 122, bpd: 80, spo2: 97, temp: 37.3, rr: 19, etco2: 30 },
    alerts: []
  }
];

// ── Vital Thresholds ──
const THRESHOLDS = {
  hr:    { warnLo: 55, warnHi: 105, critLo: 40, critHi: 130 },
  bps:   { warnLo: 90, warnHi: 145, critLo: 70, critHi: 180 },
  bpd:   { warnLo: 55, warnHi: 95,  critLo: 40, critHi: 110 },
  spo2:  { warnLo: 94, critLo: 90 },
  temp:  { warnLo: 36.0, warnHi: 38.3, critLo: 35.0, critHi: 39.5 },
  rr:    { warnLo: 10, warnHi: 22, critLo: 8, critHi: 30 },
  etco2: { warnLo: 35, warnHi: 45, critLo: 20, critHi: 55 }
};

// ── Runtime State ──
let liveVitals = {};
PATIENTS.forEach(p => { liveVitals[p.id] = { ...p.vitals }; });

let globalAlerts = [
  { id: 'A001', level: 'critical', patient: 'Anwar Khan',   bed: 'Bed 03', msg: 'SpO₂ critically low at 88%',         vital: 'SpO₂: 88%',   time: '10:05 AM', acked: false },
  { id: 'A002', level: 'warning',  patient: 'Priya Sharma', bed: 'Bed 02', msg: 'Heart rate elevated above threshold', vital: 'HR: 108 bpm', time: '09:48 AM', acked: false },
  { id: 'A003', level: 'warning',  patient: 'Anwar Khan',   bed: 'Bed 03', msg: 'Respiratory rate high',              vital: 'RR: 29/min',  time: '09:12 AM', acked: true  }
];

const USER_ROLES = {
  doctor: { name: 'Dr. Mahesh KM',     initials: 'MK', role: 'Intensivist · On Call', ward: HOSPITAL.ward },
  nurse:  { name: 'Nurse Asha',         initials: 'AS', role: 'Shift Nurse · Ward 6A', ward: HOSPITAL.ward },
  admin:  { name: 'Govardhanswamy GN',  initials: 'GG', role: 'Hospital Admin',         ward: 'All Wards'   }
};

let currentUser = USER_ROLES.doctor;
let selectedPatientId = null;
