"use client";

import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ArrowLeft, ArrowRight, Calendar, Sparkles, Check, AlertCircle, 
  RotateCcw, Download, FileSpreadsheet, FileText, ChevronDown, 
  Search, RefreshCw, AlertTriangle, UserCheck, X, LogOut
} from "lucide-react";
import XLSX from "xlsx-js-style";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// Type definitions
interface Person {
  person_id: number;
  gender: "MALE" | "FEMALE";
  name: string;
}

interface Place {
  place_id: number;
  name: string;
  type: "MALE" | "FEMALE";
  meeting_day: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "SUNDAY";
  time_slot: "EARLY_MORNING" | "EARLY_EVENING" | "LATE_EVENING";
}

interface ScheduleEntry {
  schedule_id?: number;
  week_start_date: string;
  place_id: number;
  person_id: number | null;
  scheduled_date: string;
  person_name?: string;
  person_gender?: string;
  place_name?: string;
  place_type?: string;
  meeting_day?: string;
  time_slot?: string;
}

interface HistoryEntry {
  place_id: number;
  person_id: number;
  last_scheduled_week: string;
}

const DAYS_OF_WEEK = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "SUNDAY"] as const;

const TIME_SLOT_LABELS: Record<string, string> = {
  EARLY_MORNING: "Early Morning (सकाळी)",
  EARLY_EVENING: "Early Evening (संध्याकाळी )",
  LATE_EVENING: "Late Evening (रात्री)",
};

const DAY_OFFSETS: Record<string, number> = {
  MONDAY: 0,
  TUESDAY: 1,
  WEDNESDAY: 2,
  THURSDAY: 3,
  FRIDAY: 4,
  SATURDAY: 5,
  SUNDAY: 6,
};

const DAY_MARATHI: Record<string, string> = {
  MONDAY: "सोमवार",
  TUESDAY: "मंगळवार",
  WEDNESDAY: "बुधवार",
  THURSDAY: "गुरुवार",
  SUNDAY: "रविवार"
};

const formatTimeSlotMarathi = (slot: string): string => {
  if (slot === "LATE_EVENING") return "रात्री ७:४५ ते १०:३०";
  if (slot === "EARLY_MORNING") return "स ७:४५ ते १०:३०";
  if (slot === "EARLY_EVENING") return "संध्या ७:४५ ते १०:३०";
  return slot;
};

// Devnagari number converter for dates/counts
const toDevnagariNum = (num: number | string): string => {
  if (num === 0 || num === "0") return "";
  const devnagariDigits = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
  return String(num).split('').map(char => {
    const digit = parseInt(char, 10);
    return isNaN(digit) ? char : devnagariDigits[digit];
  }).join('');
};

const formatDevnagariDate = (dateStr: string): string => {
  if (!dateStr) return "";
  const cleanDate = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
  const parts = cleanDate.split('-');
  if (parts.length !== 3) return dateStr;
  const y = toDevnagariNum(parts[0]);
  const m = toDevnagariNum(parts[1]);
  const d = toDevnagariNum(parts[2]);
  return `${d}/${m}/${y}`;
};

// Timezone-safe local date parser
function parseLocalDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  const cleanStr = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
  const parts = cleanStr.split('-');
  if (parts.length === 3) {
    const [year, month, day] = parts.map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(dateStr);
}

// Date helpers
function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateForDisplay(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function getScheduledDate(baseDateStr: string, day: string): string {
  const baseDate = parseLocalDate(baseDateStr);
  const offset = DAY_OFFSETS[day.toUpperCase()] || 0;
  baseDate.setDate(baseDate.getDate() + offset);
  return formatDate(baseDate);
}

export default function Home() {
  // App states
  const [people, setPeople] = useState<Person[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [schedules, setSchedules] = useState<Record<number, number | null>>({}); // place_id -> person_id
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(getMonday(new Date()));
  const [currentTab, setCurrentTab] = useState<"schedule" | "history">("schedule");
  
  // Loading & Action states
  const [loading, setLoading] = useState<boolean>(true);
  const [weekLoading, setWeekLoading] = useState<boolean>(false);
  const [savingStatus, setSavingStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Navigation and Filter states
  const [activeDay, setActiveDay] = useState<typeof DAYS_OF_WEEK[number]>("MONDAY");
  const [searchQuery, setSearchQuery] = useState<string>("");
  
  // Modals
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [exportStartDate, setExportStartDate] = useState<string>(formatDate(getMonday(new Date())));
  const [exportEndDate, setExportEndDate] = useState<string>(formatDate(getMonday(new Date())));
  const [exportLoading, setExportLoading] = useState<boolean>(false);
  
  // For out-of-cycle warning dialog
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  // States for History tab
  const [selectedHistoryPersonId, setSelectedHistoryPersonId] = useState<string>("");
  const [historyStartDate, setHistoryStartDate] = useState<string>(`${new Date().getFullYear()}-01-01`);
  const [historyEndDate, setHistoryEndDate] = useState<string>(`${new Date().getFullYear()}-12-31`);
  const [historyRecords, setHistoryRecords] = useState<any[]>([]);
  const [historySearchLoading, setHistorySearchLoading] = useState<boolean>(false);
  const [historyHasSearched, setHistoryHasSearched] = useState<boolean>(false);

  const weekStartStr = useMemo(() => formatDate(currentWeekStart), [currentWeekStart]);
  const weekEndDisplay = useMemo(() => {
    const end = new Date(currentWeekStart);
    end.setDate(end.getDate() + 6);
    return formatDateForDisplay(end);
  }, [currentWeekStart]);

  // Load initial data
  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        const [peopleRes, placesRes] = await Promise.all([
          fetch("/api/people").then(r => r.json()),
          fetch("/api/places").then(r => r.json())
        ]);
        setPeople(peopleRes);
        setPlaces(placesRes);
      } catch (err) {
        console.error("Failed to load initial data", err);
        setErrorMessage("Failed to load setup data from database.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  // Fetch schedule and history when week changes
  useEffect(() => {
    async function loadWeekData() {
      try {
        setWeekLoading(true);
        setSavingStatus("idle");
        setErrorMessage(null);
        
        const [schedRes, histRes] = await Promise.all([
          fetch(`/api/schedule?week_start_date=${weekStartStr}`).then(async r => {
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || "Failed to fetch schedules");
            return d;
          }),
          fetch("/api/schedule/history").then(async r => {
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || "Failed to fetch history");
            return d;
          })
        ]);

        if (Array.isArray(schedRes)) {
          const map: Record<number, number | null> = {};
          // Initialize map with nulls for all places
          places.forEach(p => {
            map[p.place_id] = null;
          });
          // Fill in existing schedules
          schedRes.forEach((s: ScheduleEntry) => {
            map[s.place_id] = s.person_id;
          });
          setSchedules(map);
        }
        if (Array.isArray(histRes)) {
          setHistory(histRes);
        }
      } catch (err: any) {
        console.error("Failed to load week schedules", err);
        setErrorMessage(err.message || "Failed to load schedules for the selected week.");
      } finally {
        setWeekLoading(false);
      }
    }

    if (places.length > 0) {
      loadWeekData();
    }
  }, [weekStartStr, places]);

  // Helper mapping place -> person history
  const historyMap = useMemo(() => {
    const map = new Map<string, string>();
    history.forEach(h => {
      map.set(`${h.place_id}|${h.person_id}`, h.last_scheduled_week);
    });
    return map;
  }, [history]);

  // Calculate workloads in the CURRENT week locally based on state
  const currentWeekWorkloads = useMemo(() => {
    const workloads: Record<number, number> = {};
    people.forEach(p => {
      workloads[Number(p.person_id)] = 0;
    });
    Object.values(schedules).forEach(pid => {
      if (pid) {
        const numPid = Number(pid);
        workloads[numPid] = (workloads[numPid] || 0) + 1;
      }
    });
    return workloads;
  }, [schedules, people]);

  // Check if all places in a specific day are allocated
  const isDayFullyAllocated = (day: string) => {
    const dayPlaces = places.filter(p => p.meeting_day === day);
    if (dayPlaces.length === 0) return false;
    return dayPlaces.every(p => schedules[p.place_id] !== null && schedules[p.place_id] !== undefined);
  };

  // Check if all places in the week are allocated
  const isWeekFullyAllocated = useMemo(() => {
    if (places.length === 0) return false;
    return places.every(p => schedules[p.place_id] !== null && schedules[p.place_id] !== undefined);
  }, [places, schedules]);

  // Fetch person history from database
  const fetchPersonHistory = async () => {
    if (!selectedHistoryPersonId) return;
    setHistorySearchLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/schedule/person-history?person_id=${selectedHistoryPersonId}&start_date=${historyStartDate}&end_date=${historyEndDate}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch history");
      }
      setHistoryRecords(data);
      setHistoryHasSearched(true);
    } catch (error: any) {
      console.error(error);
      setErrorMessage(error.message || "Failed to fetch person history.");
    } finally {
      setHistorySearchLoading(false);
    }
  };

  // Perform a local schedule save (optimistic background sync with transactional rollback)
  const saveScheduleToDb = async (
    updatedSchedules: Record<number, number | null>,
    previousSchedules: Record<number, number | null>
  ) => {
    setSavingStatus("saving");
    setErrorMessage(null);
    try {
      const scheduleArray = Object.entries(updatedSchedules).map(([placeIdStr, personId]) => {
        const place_id = Number(placeIdStr);
        const place = places.find(p => p.place_id === place_id);
        const scheduled_date = place ? getScheduledDate(weekStartStr, place.meeting_day) : weekStartStr;
        return {
          place_id,
          person_id: personId,
          scheduled_date
        };
      });

      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          week_start_date: weekStartStr,
          schedules: scheduleArray
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save schedule");
      }
      setSavingStatus("saved");
      
      // Re-fetch history to update priorities dynamically
      const histRes = await fetch("/api/schedule/history").then(r => r.json());
      if (Array.isArray(histRes)) {
        setHistory(histRes);
      }
    } catch (err: any) {
      console.error(err);
      setSavingStatus("error");
      setErrorMessage(err.message || "An error occurred while saving the schedule.");
      // Rollback to previous state
      setSchedules(previousSchedules);
    }
  };

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        window.location.href = "/login";
      }
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  // Select week navigation
  const handleWeekChange = (offset: number) => {
    const newMonday = new Date(currentWeekStart);
    newMonday.setDate(newMonday.getDate() + offset * 7);
    setCurrentWeekStart(newMonday);
  };

  const handleDateSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value) {
      setCurrentWeekStart(getMonday(parseLocalDate(e.target.value)));
    }
  };

  // Change individual assignment
  const handleAssignPerson = (placeId: number, personId: number | null) => {
    const previousAssignment = schedules[placeId];
    if (Number(previousAssignment) === Number(personId)) return; // No change, skip saving
    
    const newSchedules = { ...schedules, [placeId]: personId };
    
    if (personId) {
      const place = places.find(p => p.place_id === placeId);
      if (place) {
        // Find if this person is already assigned elsewhere on the same day
        const doubleBooked = Object.entries(newSchedules).find(([pIdStr, assignedPid]) => {
          const pId = Number(pIdStr);
          if (pId === placeId || !assignedPid || Number(assignedPid) !== Number(personId)) return false;
          
          const otherPlace = places.find(p => p.place_id === pId);
          return otherPlace && otherPlace.meeting_day === place.meeting_day;
        });

        if (doubleBooked) {
          const otherPlace = places.find(p => p.place_id === Number(doubleBooked[0]));
          alert(`Conflict! ${people.find(p => Number(p.person_id) === Number(personId))?.name} is already scheduled to "${otherPlace?.name}" on ${place.meeting_day}. Only one meeting per day is allowed.`);
          return;
        }

        // Show out-of-cycle warnings in the UI dynamically (as a non-blocking toast/notice)
        const lastWeek = historyMap.get(`${placeId}|${Number(personId)}`);
        if (lastWeek) {
          // Verify if there are other eligible people who have NEVER been scheduled here
          const eligiblePeople = people.filter(p => place.type === "FEMALE" || p.gender === "MALE");
          const anyNeverScheduled = eligiblePeople.some(p => !historyMap.has(`${placeId}|${Number(p.person_id)}`));
          
          if (anyNeverScheduled) {
            setWarningMessage(`${people.find(p => Number(p.person_id) === Number(personId))?.name} यांना पूर्वी ${formatDevnagariDate(lastWeek)} च्या आठवड्यात येथे संधी मिळाली होती. इतर पात्र सदस्यांना या चक्रात अद्याप संधी मिळालेली नाही!`);
            // Auto hide warning message after 8 seconds
            setTimeout(() => setWarningMessage(null), 8000);
          }
        }
      }
    }

    setSchedules(newSchedules);
    saveScheduleToDb(newSchedules, schedules);
  };

  // Run Auto Scheduler
  const handleAutoSchedule = async () => {
    setSavingStatus("saving");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/schedule/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week_start_date: weekStartStr })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed auto-scheduling");

      // Set state locally
      const map: Record<number, number | null> = {};
      places.forEach(p => {
        map[p.place_id] = null;
      });
      data.schedules.forEach((s: any) => {
        map[s.place_id] = s.person_id;
      });
      setSchedules(map);
      setSavingStatus("saved");

      // Reload history
      const histRes = await fetch("/api/schedule/history").then(r => r.json());
      if (Array.isArray(histRes)) {
        setHistory(histRes);
      }
    } catch (err: any) {
      console.error(err);
      setSavingStatus("error");
      setErrorMessage(err.message || "Auto-scheduling failed.");
    }
  };

  // Clear current week schedule
  const handleClearSchedule = () => {
    if (confirm("Are you sure you want to clear all assignments for this week?")) {
      const map: Record<number, number | null> = {};
      places.forEach(p => {
        map[p.place_id] = null;
      });
      setSchedules(map);
      saveScheduleToDb(map, schedules);
    }
  };

  // EXPORT TO EXCEL
  const handleExcelExport = async (isRange: boolean) => {
    try {
      setExportLoading(true);
      let dataToExport: any[] = [];

      if (!isRange) {
        // Fetch current week data
        const res = await fetch(`/api/schedule?week_start_date=${weekStartStr}`).then(r => r.json());
        dataToExport = res;
      } else {
        // Loop and fetch schedules for weeks in date range
        let start = parseLocalDate(exportStartDate);
        const end = parseLocalDate(exportEndDate);
        
        // Ensure starting on Monday
        start = getMonday(start);
        const weekDates: string[] = [];
        
        while (start <= end) {
          weekDates.push(formatDate(start));
          start.setDate(start.getDate() + 7);
        }

        const allSchedules = await Promise.all(
          weekDates.map(dateStr => 
            fetch(`/api/schedule?week_start_date=${dateStr}`).then(r => r.json())
          )
        );
        dataToExport = allSchedules.flat();
      }

      if (dataToExport.length === 0) {
        alert("No schedule records found to export.");
        return;
      }

      // Group data by week_start_date (string)
      const dataByWeek: Record<string, any[]> = {};
      dataToExport.forEach(item => {
        const wsd = item.week_start_date;
        if (!dataByWeek[wsd]) dataByWeek[wsd] = [];
        dataByWeek[wsd].push(item);
      });

      const workbook = XLSX.utils.book_new();
      const sortedWeeks = Object.keys(dataByWeek).sort();

      sortedWeeks.forEach(wsd => {
        const weekSchedules = dataByWeek[wsd];
        const mondayDate = parseLocalDate(wsd);
        const sundayDate = new Date(mondayDate);
        sundayDate.setDate(sundayDate.getDate() + 6);

        // Date helpers for this specific week
        const formatRow3Date = (d: Date): string => {
          const day = d.getDate();
          const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          const month = monthNames[d.getMonth()];
          const year = String(d.getFullYear()).slice(-2);
          return `${day}-${month}-${year}`;
        };

        const getDayDateStr = (baseDateStr: string, offset: number) => {
          const d = parseLocalDate(baseDateStr);
          d.setDate(d.getDate() + offset);
          return String(d.getDate()).padStart(2, "0");
        };

        // Sheet name (max 31 chars in Excel)
        const sheetName = `${formatRow3Date(mondayDate)} ते ${formatRow3Date(sundayDate)}`.substring(0, 31);
        const ws: any = {};

        // Define column widths
        ws["!cols"] = [
          { wch: 3 },  // A
          { wch: 3 },  // B
          { wch: 26 }, // C - सदस्याचे नाव
          { wch: 15 }, // D - सोमवार
          { wch: 15 }, // E - मंगळवार
          { wch: 15 }, // F - बुधवार
          { wch: 15 }, // G - गुरुवार
          { wch: 5 },  // H - Spacing
          { wch: 15 }  // I - रविवार
        ];

        // Define cell styles
        const borderThin = {
          top: { style: "thin", color: { rgb: "000000" } },
          bottom: { style: "thin", color: { rgb: "000000" } },
          left: { style: "thin", color: { rgb: "000000" } },
          right: { style: "thin", color: { rgb: "000000" } }
        };

        const titleStyle = {
          font: { name: "Calibri", sz: 11, bold: false },
          alignment: { horizontal: "center", vertical: "center" }
        };

        const boldTitleStyle = {
          font: { name: "Calibri", sz: 11, bold: true },
          alignment: { horizontal: "left", vertical: "center" }
        };

        const headerCStyle = {
          font: { name: "Calibri", sz: 11, bold: true },
          alignment: { horizontal: "center", vertical: "center" },
          border: borderThin
        };

        const headerGreenStyle = {
          font: { name: "Calibri", sz: 11, bold: true },
          alignment: { horizontal: "center", vertical: "center" },
          fill: { fgColor: { rgb: "00B050" } },
          border: borderThin
        };

        const nameCellStyle = {
          font: { name: "Calibri", sz: 11, bold: false },
          alignment: { horizontal: "left", vertical: "center" },
          border: borderThin
        };

        const valueCellStyle = {
          font: { name: "Calibri", sz: 11, bold: false },
          alignment: { horizontal: "center", vertical: "center" },
          border: borderThin
        };

        const boldValueCellStyle = {
          font: { name: "Calibri", sz: 11, bold: true },
          alignment: { horizontal: "center", vertical: "center" },
          border: borderThin
        };

        // Write cell helper
        const writeCell = (colChar: string, rowNum: number, value: any, style?: any) => {
          const cellRef = `${colChar}${rowNum}`;
          ws[cellRef] = {
            t: "s",
            v: String(value),
            s: style
          };
        };

        // Row 1: ॥ श्री राम समर्थ ॥
        writeCell("C", 1, "॥ श्री राम समर्थ ॥", titleStyle);
        // Row 2: ॥ जय जय रघुवीर समर्थ ॥
        writeCell("C", 2, "॥ जय जय रघुवीर समर्थ ॥", titleStyle);
        
        // Row 3: श्रीबैठक समिती - खालापूर          Date range
        const titleLeft = "श्रीबैठक समिती - खालापूर";
        const titleRight = `${formatRow3Date(mondayDate)} ते ${formatRow3Date(sundayDate)}`;
        const spaces = " ".repeat(60);
        writeCell("C", 3, titleLeft + spaces + titleRight, boldTitleStyle);

        // Row 4: Headers
        writeCell("C", 4, "सदस्याचे नाव", headerCStyle);
        writeCell("D", 4, `सोमवार-${getDayDateStr(wsd, 0)}`, headerGreenStyle);
        writeCell("E", 4, `मंगळवार-${getDayDateStr(wsd, 1)}`, headerGreenStyle);
        writeCell("F", 4, `बुधवार-${getDayDateStr(wsd, 2)}`, headerGreenStyle);
        writeCell("G", 4, `गुरुवार -${getDayDateStr(wsd, 3)}`, headerGreenStyle);
        writeCell("H", 4, "", headerCStyle);
        writeCell("I", 4, `रविवार - ${getDayDateStr(wsd, 6)}`, headerGreenStyle);

        // Group people
        const males = people.filter(p => p.gender === "MALE").sort((a, b) => a.name.localeCompare(b.name, "mr"));
        const females = people.filter(p => p.gender === "FEMALE").sort((a, b) => a.name.localeCompare(b.name, "mr"));

        let currentRow = 5;

        // Write Male rows
        males.forEach(person => {
          writeCell("C", currentRow, person.name, nameCellStyle);
          
          const findPlace = (day: string) => {
            const entry = weekSchedules.find(s => Number(s.person_id) === Number(person.person_id) && s.meeting_day === day);
            return entry ? entry.place_name || "" : "";
          };

          writeCell("D", currentRow, findPlace("MONDAY"), valueCellStyle);
          writeCell("E", currentRow, findPlace("TUESDAY"), valueCellStyle);
          writeCell("F", currentRow, findPlace("WEDNESDAY"), valueCellStyle);
          writeCell("G", currentRow, findPlace("THURSDAY"), valueCellStyle);
          writeCell("H", currentRow, "", valueCellStyle);
          writeCell("I", currentRow, findPlace("SUNDAY"), valueCellStyle);

          currentRow++;
        });

        // Determine female start row (Row 23, or dynamic if males exceed)
        const femaleStartRow = Math.max(23, currentRow + 4);
        
        // Write blank spacer rows with borders
        for (let r = currentRow; r < femaleStartRow; r++) {
          writeCell("C", r, "", nameCellStyle);
          writeCell("D", r, "", valueCellStyle);
          writeCell("E", r, "", valueCellStyle);
          writeCell("F", r, "", valueCellStyle);
          writeCell("G", r, "", valueCellStyle);
          writeCell("H", r, "", valueCellStyle);
          writeCell("I", r, "", valueCellStyle);
        }

        currentRow = femaleStartRow;

        // Write Female rows
        females.forEach(person => {
          writeCell("C", currentRow, person.name, nameCellStyle);

          const findPlace = (day: string) => {
            const entry = weekSchedules.find(s => Number(s.person_id) === Number(person.person_id) && s.meeting_day === day);
            return entry ? entry.place_name || "" : "";
          };

          writeCell("D", currentRow, findPlace("MONDAY"), valueCellStyle);
          writeCell("E", currentRow, findPlace("TUESDAY"), valueCellStyle);
          writeCell("F", currentRow, findPlace("WEDNESDAY"), valueCellStyle);
          writeCell("G", currentRow, findPlace("THURSDAY"), valueCellStyle);
          writeCell("H", currentRow, "", valueCellStyle);
          writeCell("I", currentRow, findPlace("SUNDAY"), valueCellStyle);

          currentRow++;
        });

        // Totals rows start at Row 35 or dynamic if females exceed
        const totalStartRow = Math.max(35, currentRow);

        // Write blank rows between females and totals if needed
        for (let r = currentRow; r < totalStartRow; r++) {
          writeCell("C", r, "", nameCellStyle);
          writeCell("D", r, "", valueCellStyle);
          writeCell("E", r, "", valueCellStyle);
          writeCell("F", r, "", valueCellStyle);
          writeCell("G", r, "", valueCellStyle);
          writeCell("H", r, "", valueCellStyle);
          writeCell("I", r, "", valueCellStyle);
        }

        currentRow = totalStartRow;

        // Helper to convert standard digits to Devnagari digits
        const toDevnagariNum = (num: number): string => {
          if (num === 0) return "";
          const devnagariDigits = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
          return String(num).split('').map(char => {
            const digit = parseInt(char, 10);
            return isNaN(digit) ? char : devnagariDigits[digit];
          }).join('');
        };

        // Calculate counts
        const getCountsByGender = (day: string, gender: "MALE" | "FEMALE") => {
          return weekSchedules.filter(s => s.meeting_day === day && s.person_gender === gender && s.person_id).length;
        };

        const getDayTotal = (day: string) => {
          const m = getCountsByGender(day, "MALE");
          const f = getCountsByGender(day, "FEMALE");
          return m + f;
        };

        // Row 35: Male count
        writeCell("C", currentRow, "", nameCellStyle);
        writeCell("D", currentRow, toDevnagariNum(getCountsByGender("MONDAY", "MALE")), boldValueCellStyle);
        writeCell("E", currentRow, toDevnagariNum(getCountsByGender("TUESDAY", "MALE")), boldValueCellStyle);
        writeCell("F", currentRow, toDevnagariNum(getCountsByGender("WEDNESDAY", "MALE")), boldValueCellStyle);
        writeCell("G", currentRow, toDevnagariNum(getCountsByGender("THURSDAY", "MALE")), boldValueCellStyle);
        writeCell("H", currentRow, "", valueCellStyle);
        writeCell("I", currentRow, toDevnagariNum(getCountsByGender("SUNDAY", "MALE")), boldValueCellStyle);
        currentRow++;

        // Row 36: Female count
        writeCell("C", currentRow, "", nameCellStyle);
        writeCell("D", currentRow, toDevnagariNum(getCountsByGender("MONDAY", "FEMALE")), boldValueCellStyle);
        writeCell("E", currentRow, toDevnagariNum(getCountsByGender("TUESDAY", "FEMALE")), boldValueCellStyle);
        writeCell("F", currentRow, toDevnagariNum(getCountsByGender("WEDNESDAY", "FEMALE")), boldValueCellStyle);
        writeCell("G", currentRow, toDevnagariNum(getCountsByGender("THURSDAY", "FEMALE")), boldValueCellStyle);
        writeCell("H", currentRow, "", valueCellStyle);
        writeCell("I", currentRow, toDevnagariNum(getCountsByGender("SUNDAY", "FEMALE")), boldValueCellStyle);
        currentRow++;

        // Row 37: Total count
        writeCell("C", currentRow, "", nameCellStyle);
        writeCell("D", currentRow, toDevnagariNum(getDayTotal("MONDAY")), boldValueCellStyle);
        writeCell("E", currentRow, toDevnagariNum(getDayTotal("TUESDAY")), boldValueCellStyle);
        writeCell("F", currentRow, toDevnagariNum(getDayTotal("WEDNESDAY")), boldValueCellStyle);
        writeCell("G", currentRow, toDevnagariNum(getDayTotal("THURSDAY")), boldValueCellStyle);
        writeCell("H", currentRow, "", valueCellStyle);
        writeCell("I", currentRow, toDevnagariNum(getDayTotal("SUNDAY")), boldValueCellStyle);

        // Merges: C1:I1, C2:I2, C3:I3
        ws["!merges"] = [
          { s: { r: 0, c: 2 }, e: { r: 0, c: 8 } },
          { s: { r: 1, c: 2 }, e: { r: 1, c: 8 } },
          { s: { r: 2, c: 2 }, e: { r: 2, c: 8 } }
        ];

        // Set boundary range
        ws["!ref"] = `C1:I${currentRow}`;

        XLSX.utils.book_append_sheet(workbook, ws, sheetName);
      });

      const fileName = isRange 
        ? `Schedules_Range_${exportStartDate}_to_${exportEndDate}.xlsx`
        : `Schedules_Week_${weekStartStr}.xlsx`;
      
      XLSX.writeFile(workbook, fileName);
      setShowExportModal(false);
    } catch (error) {
      console.error(error);
      alert("Failed to export schedule to Excel.");
    } finally {
      setExportLoading(false);
    }
  };

  // EXPORT TO CHITYA EXCEL
  const handleChityaExcelExport = async (isRange: boolean) => {
    try {
      setExportLoading(true);
      let dataToExport: any[] = [];

      if (!isRange) {
        // Fetch current week data
        const res = await fetch(`/api/schedule?week_start_date=${weekStartStr}`).then(r => r.json());
        dataToExport = res;
      } else {
        // Loop and fetch schedules for weeks in date range
        let start = parseLocalDate(exportStartDate);
        const end = parseLocalDate(exportEndDate);
        
        // Ensure starting on Monday
        start = getMonday(start);
        const weekDates: string[] = [];
        
        while (start <= end) {
          weekDates.push(formatDate(start));
          start.setDate(start.getDate() + 7);
        }

        const allSchedules = await Promise.all(
          weekDates.map(dateStr => 
            fetch(`/api/schedule?week_start_date=${dateStr}`).then(r => r.json())
          )
        );
        dataToExport = allSchedules.flat();
      }

      if (dataToExport.length === 0) {
        alert("No schedule records found to export.");
        return;
      }

      // Group data by week_start_date (string)
      const dataByWeek: Record<string, any[]> = {};
      dataToExport.forEach(item => {
        const wsd = item.week_start_date;
        if (!dataByWeek[wsd]) dataByWeek[wsd] = [];
        dataByWeek[wsd].push(item);
      });

      const workbook = XLSX.utils.book_new();
      const sortedWeeks = Object.keys(dataByWeek).sort();

      sortedWeeks.forEach(wsd => {
        const weekSchedules = dataByWeek[wsd];
        const mondayDate = parseLocalDate(wsd);
        const sundayDate = new Date(mondayDate);
        sundayDate.setDate(sundayDate.getDate() + 6);

        // Date helpers for this specific week
        const formatRow3Date = (d: Date): string => {
          const day = d.getDate();
          const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          const month = monthNames[d.getMonth()];
          const year = String(d.getFullYear()).slice(-2);
          return `${day}-${month}-${year}`;
        };

        const getDayDateStr = (baseDateStr: string, offset: number) => {
          const d = parseLocalDate(baseDateStr);
          d.setDate(d.getDate() + offset);
          return String(d.getDate()).padStart(2, "0");
        };

        // Devnagari number converter for dates
        const toDevnagariNumLocal = (num: number | string): string => {
          const devnagariDigits = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
          return String(num).split('').map(char => {
            const digit = parseInt(char, 10);
            return isNaN(digit) ? char : devnagariDigits[digit];
          }).join('');
        };

        const formatDevnagariDateLocal = (dateStr: string): string => {
          const parts = dateStr.split('-');
          if (parts.length !== 3) return dateStr;
          const y = toDevnagariNumLocal(parts[0]);
          const m = toDevnagariNumLocal(parts[1]);
          const d = toDevnagariNumLocal(parts[2]);
          return `${d}/${m}/${y}`;
        };

        const DAY_MARATHI_LOCAL: Record<string, string> = {
          MONDAY: "सोमवार",
          TUESDAY: "मंगळवार",
          WEDNESDAY: "बुधवार",
          THURSDAY: "गुरुवार",
          SUNDAY: "रविवार"
        };

        const formatTimeSlotMarathiLocal = (slot: string): string => {
          if (slot === "LATE_EVENING") return "रात्री ७:४५ ते १०:३०";
          if (slot === "EARLY_MORNING") return "स ७:४५ ते १०:३०";
          if (slot === "EARLY_EVENING") return "संध्या ७:४५ ते १०:३०";
          return slot;
        };

        // Sheet name (max 31 chars in Excel)
        const sheetName = `Chitya ${formatRow3Date(mondayDate)}`.substring(0, 31);
        const ws: any = {};

        // Define column widths:
        ws["!cols"] = [
          { wch: 3 },  // A
          { wch: 12 }, // B - दिनांक
          { wch: 10 }, // C - वार
          { wch: 10 }, // D - स्त्री\पु.
          { wch: 22 }, // E - श्री बैठकीचे ठिकाण
          { wch: 22 }, // F - वेळ
          { wch: 3 },  // G
          { wch: 12 }, // H - दिनांक
          { wch: 10 }, // I - वार
          { wch: 10 }, // J - स्त्री\पु.
          { wch: 22 }, // K - श्री बैठकीचे ठिकाण
          { wch: 22 }  // L - वेळ
        ];

        // Define cell styles
        const borderThin = {
          top: { style: "thin", color: { rgb: "000000" } },
          bottom: { style: "thin", color: { rgb: "000000" } },
          left: { style: "thin", color: { rgb: "000000" } },
          right: { style: "thin", color: { rgb: "000000" } }
        };

        const titleStyle = {
          font: { name: "Calibri", sz: 11, bold: false },
          alignment: { horizontal: "center", vertical: "center" },
          border: borderThin
        };

        const boldTitleStyle = {
          font: { name: "Calibri", sz: 11, bold: true },
          alignment: { horizontal: "center", vertical: "center" },
          border: borderThin
        };

        const headerStyle = {
          font: { name: "Calibri", sz: 11, bold: true },
          alignment: { horizontal: "center", vertical: "center" },
          border: borderThin
        };

        const cellStyle = {
          font: { name: "Calibri", sz: 11, bold: false },
          alignment: { horizontal: "center", vertical: "center" },
          border: borderThin
        };

        // Write cell helper
        const writeCellRaw = (colChar: string, rowNum: number, value: any, style?: any) => {
          const cellRef = `${colChar}${rowNum}`;
          ws[cellRef] = {
            t: "s",
            v: String(value),
            s: style
          };
        };

        // Merges array
        const merges: any[] = [];

        // Write card helper
        const writeCard = (person: any, personSchedules: any[], colOffset: number, startRow: number) => {
          const colLetters = colOffset === 0 
            ? ["B", "C", "D", "E", "F"] 
            : ["H", "I", "J", "K", "L"];

          const colIndices = colOffset === 0
            ? [1, 2, 3, 4, 5]
            : [7, 8, 9, 10, 11];

          // Merged Rows 1-4
          merges.push({ s: { r: startRow - 1, c: colIndices[0] }, e: { r: startRow - 1, c: colIndices[4] } });
          merges.push({ s: { r: startRow,     c: colIndices[0] }, e: { r: startRow,     c: colIndices[4] } });
          merges.push({ s: { r: startRow + 1, c: colIndices[0] }, e: { r: startRow + 1, c: colIndices[4] } });
          merges.push({ s: { r: startRow + 2, c: colIndices[0] }, e: { r: startRow + 2, c: colIndices[4] } });

          // Write cells for merged rows (all 5 columns to ensure borders are drawn)
          colLetters.forEach((col, idx) => {
            writeCellRaw(col, startRow,     idx === 0 ? `दिनांक   ${formatDevnagariDateLocal(formatDate(mondayDate))}   ${formatDevnagariDateLocal(formatDate(sundayDate))}` : "", boldTitleStyle);
            writeCellRaw(col, startRow + 1, idx === 0 ? "॥ श्री राम समर्थ ॥" : "", titleStyle);
            writeCellRaw(col, startRow + 2, idx === 0 ? "॥ जय जय रघुवीर समर्थ ॥" : "", titleStyle);
            writeCellRaw(col, startRow + 3, idx === 0 ? `श्री सदस्याचे नाव - ${person.name}` : "", boldTitleStyle);
          });

          // Header Row
          writeCellRaw(colLetters[0], startRow + 4, "दिनांक", headerStyle);
          writeCellRaw(colLetters[1], startRow + 4, "वार", headerStyle);
          writeCellRaw(colLetters[2], startRow + 4, "स्त्री\\पु.", headerStyle);
          writeCellRaw(colLetters[3], startRow + 4, "श्री बैठकीचे ठिकाण", headerStyle);
          writeCellRaw(colLetters[4], startRow + 4, "वेळ", headerStyle);

          // Data Rows (Exactly 3 rows: startRow+5, startRow+6, startRow+7)
          for (let i = 0; i < 3; i++) {
            const rowNum = startRow + 5 + i;
            const sched = personSchedules[i] || null;

            if (sched) {
              writeCellRaw(colLetters[0], rowNum, formatDevnagariDateLocal(sched.scheduled_date), cellStyle);
              writeCellRaw(colLetters[1], rowNum, DAY_MARATHI_LOCAL[sched.meeting_day] || sched.meeting_day, cellStyle);
              writeCellRaw(colLetters[2], rowNum, sched.place_type === "FEMALE" ? "महिला" : "पुरुष", cellStyle);
              writeCellRaw(colLetters[3], rowNum, sched.place_name || "", cellStyle);
              writeCellRaw(colLetters[4], rowNum, formatTimeSlotMarathiLocal(sched.time_slot), cellStyle);
            } else {
              // Write empty cells with borders
              colLetters.forEach(col => {
                writeCellRaw(col, rowNum, "", cellStyle);
              });
            }
          }
        };

        // Filter and sort active people (who have schedules in this week)
        const activePeople = people
          .filter(p => weekSchedules.some(s => Number(s.person_id) === Number(p.person_id)))
          .sort((a, b) => {
            if (a.gender !== b.gender) {
              return a.gender === "MALE" ? -1 : 1; // Males first
            }
            return a.name.localeCompare(b.name, "mr"); // Marathi alphabetical
          });

        activePeople.forEach((person, idx) => {
          const personSchedules = weekSchedules
            .filter(s => Number(s.person_id) === Number(person.person_id))
            .sort((a, b) => {
              const daysOrder = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
              return daysOrder.indexOf(a.meeting_day) - daysOrder.indexOf(b.meeting_day);
            });

          const colOffset = idx % 2; // 0 = Left, 1 = Right
          const verticalIdx = Math.floor(idx / 2);
          const startRow = 2 + verticalIdx * 9; // Row 2, 11, 20, 29...

          writeCard(person, personSchedules, colOffset, startRow);
        });

        // Set Merges and boundary range
        ws["!merges"] = merges;
        const maxVerticalIdx = Math.ceil(activePeople.length / 2);
        const maxRow = maxVerticalIdx > 0 ? 1 + maxVerticalIdx * 9 : 1;
        ws["!ref"] = `B2:L${maxRow}`;

        XLSX.utils.book_append_sheet(workbook, ws, sheetName);
      });

      const fileName = isRange 
        ? `Chitya_Range_${exportStartDate}_to_${exportEndDate}.xlsx`
        : `Chitya_Week_${weekStartStr}.xlsx`;
      
      XLSX.writeFile(workbook, fileName);
      setShowExportModal(false);
    } catch (error) {
      console.error(error);
      alert("Failed to export Chitya to Excel.");
    } finally {
      setExportLoading(false);
    }
  };

  // EXPORT TO PDF
  const handlePdfExport = async (isRange: boolean) => {
    try {
      setExportLoading(true);
      let dataToExport: any[] = [];

      if (!isRange) {
        const res = await fetch(`/api/schedule?week_start_date=${weekStartStr}`).then(r => r.json());
        dataToExport = res;
      } else {
        let start = parseLocalDate(exportStartDate);
        const end = parseLocalDate(exportEndDate);
        start = getMonday(start);
        const weekDates: string[] = [];
        
        while (start <= end) {
          weekDates.push(formatDate(start));
          start.setDate(start.getDate() + 7);
        }

        const allSchedules = await Promise.all(
          weekDates.map(dateStr => 
            fetch(`/api/schedule?week_start_date=${dateStr}`).then(r => r.json())
          )
        );
        dataToExport = allSchedules.flat();
      }

      if (dataToExport.length === 0) {
        alert("No schedule records found to export.");
        return;
      }

      // Group data by week_start_date
      const dataByWeek: Record<string, any[]> = {};
      dataToExport.forEach(item => {
        const wsd = item.week_start_date;
        if (!dataByWeek[wsd]) dataByWeek[wsd] = [];
        dataByWeek[wsd].push(item);
      });

      // Load local Noto Sans Devanagari font
      const fontRes = await fetch("/NotoSansDevanagari-Regular.ttf");
      const fontBlob = await fontRes.blob();
      const fontBase64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(fontBlob);
        reader.onloadend = () => {
          const base64data = reader.result as string;
          resolve(base64data.split(",")[1]);
        };
      });

      const doc = new jsPDF("l", "mm", "a4");
      const sortedWeeks = Object.keys(dataByWeek).sort();

      sortedWeeks.forEach((wsd, index) => {
        if (index > 0) {
          doc.addPage();
        }

        // Setup font
        doc.addFileToVFS("NotoSansDevanagari-Regular.ttf", fontBase64);
        doc.addFont("NotoSansDevanagari-Regular.ttf", "NotoSansDevanagari", "normal");
        doc.setFont("NotoSansDevanagari");

        const weekSchedules = dataByWeek[wsd];
        const mondayDate = parseLocalDate(wsd);
        const sundayDate = new Date(mondayDate);
        sundayDate.setDate(sundayDate.getDate() + 6);

        // Date helpers for this specific week
        const formatRow3Date = (d: Date): string => {
          const day = d.getDate();
          const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          const month = monthNames[d.getMonth()];
          const year = String(d.getFullYear()).slice(-2);
          return `${day}-${month}-${year}`;
        };

        const getDayDateStr = (baseDateStr: string, offset: number) => {
          const d = parseLocalDate(baseDateStr);
          d.setDate(d.getDate() + offset);
          return String(d.getDate()).padStart(2, "0");
        };

        const pageWidth = doc.internal.pageSize.getWidth();

        // 1. Centered header text
        doc.setFontSize(12);
        doc.text("॥ श्री राम समर्थ ॥", pageWidth / 2, 10, { align: "center" });
        doc.text("॥ जय जय रघुवीर समर्थ ॥", pageWidth / 2, 16, { align: "center" });

        // 2. Subtitle left & right
        doc.setFontSize(10);
        doc.text("श्रीबैठक समिती - खालापूर", 14, 22);
        doc.text(`${formatRow3Date(mondayDate)} ते ${formatRow3Date(sundayDate)}`, pageWidth - 14, 22, { align: "right" });

        // Build table matrix rows
        const columns = [
          "सदस्याचे नाव",
          `सोमवार-${getDayDateStr(wsd, 0)}`,
          `मंगळवार-${getDayDateStr(wsd, 1)}`,
          `बुधवार-${getDayDateStr(wsd, 2)}`,
          `गुरुवार -${getDayDateStr(wsd, 3)}`,
          "", 
          `रविवार - ${getDayDateStr(wsd, 6)}`
        ];

        const males = people.filter(p => p.gender === "MALE").sort((a, b) => a.name.localeCompare(b.name, "mr"));
        const females = people.filter(p => p.gender === "FEMALE").sort((a, b) => a.name.localeCompare(b.name, "mr"));

        const tableRows: string[][] = [];

        const findPlace = (personId: number, day: string) => {
          const entry = weekSchedules.find(s => Number(s.person_id) === Number(personId) && s.meeting_day === day);
          return entry ? entry.place_name || "" : "";
        };

        // Write Male rows
        males.forEach(person => {
          tableRows.push([
            person.name,
            findPlace(person.person_id, "MONDAY"),
            findPlace(person.person_id, "TUESDAY"),
            findPlace(person.person_id, "WEDNESDAY"),
            findPlace(person.person_id, "THURSDAY"),
            "",
            findPlace(person.person_id, "SUNDAY")
          ]);
        });

        // Blank rows (females start at index 18, so Row 23 in Excel 1-based header rows)
        const femaleStartRowIdx = Math.max(18, tableRows.length + 4);
        while (tableRows.length < femaleStartRowIdx) {
          tableRows.push(["", "", "", "", "", "", ""]);
        }

        // Write Female rows
        females.forEach(person => {
          tableRows.push([
            person.name,
            findPlace(person.person_id, "MONDAY"),
            findPlace(person.person_id, "TUESDAY"),
            findPlace(person.person_id, "WEDNESDAY"),
            findPlace(person.person_id, "THURSDAY"),
            "",
            findPlace(person.person_id, "SUNDAY")
          ]);
        });

        // Spacer to totals row (Excel Row 35 is index 30 in body rows)
        const totalStartRowIdx = Math.max(30, tableRows.length);
        while (tableRows.length < totalStartRowIdx) {
          tableRows.push(["", "", "", "", "", "", ""]);
        }

        // Helper to convert standard digits to Devnagari digits
        const toDevnagariNumLocal = (num: number): string => {
          if (num === 0) return "";
          const devnagariDigits = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
          return String(num).split('').map(char => {
            const digit = parseInt(char, 10);
            return isNaN(digit) ? char : devnagariDigits[digit];
          }).join('');
        };

        // Calculate counts
        const getCountsByGender = (day: string, gender: "MALE" | "FEMALE") => {
          return weekSchedules.filter(s => s.meeting_day === day && s.person_gender === gender && s.person_id).length;
        };

        const getDayTotal = (day: string) => {
          const m = getCountsByGender(day, "MALE");
          const f = getCountsByGender(day, "FEMALE");
          return m + f;
        };

        // Row 35: Male count
        tableRows.push([
          "",
          toDevnagariNumLocal(getCountsByGender("MONDAY", "MALE")),
          toDevnagariNumLocal(getCountsByGender("TUESDAY", "MALE")),
          toDevnagariNumLocal(getCountsByGender("WEDNESDAY", "MALE")),
          toDevnagariNumLocal(getCountsByGender("THURSDAY", "MALE")),
          "",
          toDevnagariNumLocal(getCountsByGender("SUNDAY", "MALE"))
        ]);

        // Row 36: Female count
        tableRows.push([
          "",
          toDevnagariNumLocal(getCountsByGender("MONDAY", "FEMALE")),
          toDevnagariNumLocal(getCountsByGender("TUESDAY", "FEMALE")),
          toDevnagariNumLocal(getCountsByGender("WEDNESDAY", "FEMALE")),
          toDevnagariNumLocal(getCountsByGender("THURSDAY", "FEMALE")),
          "",
          toDevnagariNumLocal(getCountsByGender("SUNDAY", "FEMALE"))
        ]);

        // Row 37: Total count
        tableRows.push([
          "",
          toDevnagariNumLocal(getDayTotal("MONDAY")),
          toDevnagariNumLocal(getDayTotal("TUESDAY")),
          toDevnagariNumLocal(getDayTotal("WEDNESDAY")),
          toDevnagariNumLocal(getDayTotal("THURSDAY")),
          "",
          toDevnagariNumLocal(getDayTotal("SUNDAY"))
        ]);

        // Draw matrix table using autoTable
        autoTable(doc, {
          startY: 25,
          head: [columns],
          body: tableRows,
          styles: {
            font: "NotoSansDevanagari",
            fontSize: 7.5,
            cellPadding: 0.8,
            lineColor: [0, 0, 0],
            lineWidth: 0.1,
            textColor: [0, 0, 0]
          },
          columnStyles: {
            0: { halign: "left", cellWidth: 50 },
            1: { halign: "center" },
            2: { halign: "center" },
            3: { halign: "center" },
            4: { halign: "center" },
            5: { halign: "center", cellWidth: 8 },
            6: { halign: "center" }
          },
          didParseCell: function (data) {
            data.cell.styles.font = "NotoSansDevanagari";

            if (data.section === "head") {
              if (data.column.index === 0 || data.column.index === 5) {
                data.cell.styles.fillColor = [255, 255, 255];
                data.cell.styles.textColor = [0, 0, 0];
              } else {
                data.cell.styles.fillColor = [0, 176, 80];
                data.cell.styles.textColor = [0, 0, 0];
              }
              data.cell.styles.halign = "center";
              data.cell.styles.fontStyle = "bold";
            } else if (data.section === "body") {
              const totalRowsStart = data.table.body.length - 3;
              if (data.row.index >= totalRowsStart) {
                data.cell.styles.fontStyle = "bold";
                data.cell.styles.fillColor = [245, 245, 245];
              }
            }
          }
        });
      });

      const fileName = isRange 
        ? `Schedules_Range_${exportStartDate}_to_${exportEndDate}.pdf`
        : `Schedules_Week_${weekStartStr}.pdf`;

      doc.save(fileName);
      setShowExportModal(false);
    } catch (error) {
      console.error(error);
      alert("Failed to export schedule to PDF.");
    } finally {
      setExportLoading(false);
    }
  };

  // EXPORT PERSON HISTORY TO EXCEL (MARATHI ONLY)
  const handleHistoryExcelExport = () => {
    try {
      if (historyRecords.length === 0) return;
      const personName = people.find(p => String(p.person_id) === selectedHistoryPersonId)?.name || "";

      const workbook = XLSX.utils.book_new();
      const ws: any = {};

      // Define column widths
      ws["!cols"] = [
        { wch: 12 }, // A - अनुक्रमांक
        { wch: 15 }, // B - दिनांक
        { wch: 12 }, // C - वार
        { wch: 30 }, // D - श्री बैठकीचे ठिकाण
        { wch: 25 }  // E - वेळ
      ];

      const borderThin = {
        top: { style: "thin", color: { rgb: "000000" } },
        bottom: { style: "thin", color: { rgb: "000000" } },
        left: { style: "thin", color: { rgb: "000000" } },
        right: { style: "thin", color: { rgb: "000000" } }
      };

      const titleStyle = {
        font: { name: "Calibri", sz: 12, bold: true },
        alignment: { horizontal: "center", vertical: "center" }
      };

      const headerStyle = {
        font: { name: "Calibri", sz: 11, bold: true },
        alignment: { horizontal: "center", vertical: "center" },
        fill: { fgColor: { rgb: "00B050" } },
        border: borderThin
      };

      const cellStyle = {
        font: { name: "Calibri", sz: 11, bold: false },
        alignment: { horizontal: "center", vertical: "center" },
        border: borderThin
      };

      const cellLeftStyle = {
        font: { name: "Calibri", sz: 11, bold: false },
        alignment: { horizontal: "left", vertical: "center" },
        border: borderThin
      };

      const writeCell = (colChar: string, rowNum: number, value: any, style?: any) => {
        const cellRef = `${colChar}${rowNum}`;
        ws[cellRef] = {
          t: "s",
          v: String(value),
          s: style
        };
      };

      // Header Rows
      writeCell("A", 1, `श्री बैठक वाटप इतिहास - ${personName}`, titleStyle);
      writeCell("A", 2, `कालावधी: ${formatDevnagariDate(historyStartDate)} ते ${formatDevnagariDate(historyEndDate)}`, titleStyle);

      // Merges for titles
      ws["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } }
      ];

      // Table Headers
      writeCell("A", 4, "अनुक्रमांक", headerStyle);
      writeCell("B", 4, "दिनांक", headerStyle);
      writeCell("C", 4, "वार", headerStyle);
      writeCell("D", 4, "श्री बैठकीचे ठिकाण", headerStyle);
      writeCell("E", 4, "वेळ", headerStyle);

      // Data Rows
      historyRecords.forEach((record, index) => {
        const rowNum = 5 + index;
        writeCell("A", rowNum, toDevnagariNum(index + 1), cellStyle);
        writeCell("B", rowNum, formatDevnagariDate(record.scheduled_date), cellStyle);
        writeCell("C", rowNum, DAY_MARATHI[record.meeting_day] || record.meeting_day, cellStyle);
        writeCell("D", rowNum, record.place_name || "", cellLeftStyle);
        writeCell("E", rowNum, formatTimeSlotMarathi(record.time_slot), cellStyle);
      });

      const maxRow = 4 + historyRecords.length;
      ws["!ref"] = `A1:E${maxRow}`;

      XLSX.utils.book_append_sheet(workbook, ws, "इतिहास");
      XLSX.writeFile(workbook, `History_${personName}_${historyStartDate}_to_${historyEndDate}.xlsx`);
    } catch (error) {
      console.error(error);
      alert("Failed to export history to Excel.");
    }
  };

  // EXPORT PERSON HISTORY TO PDF (MARATHI ONLY)
  const handleHistoryPdfExport = async () => {
    try {
      if (historyRecords.length === 0) return;
      const personName = people.find(p => String(p.person_id) === selectedHistoryPersonId)?.name || "";

      // Load local Noto Sans Devanagari font
      const fontRes = await fetch("/NotoSansDevanagari-Regular.ttf");
      const fontBlob = await fontRes.blob();
      const fontBase64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(fontBlob);
        reader.onloadend = () => {
          const base64data = reader.result as string;
          resolve(base64data.split(",")[1]);
        };
      });

      const doc = new jsPDF("p", "mm", "a4");

      // Setup font
      doc.addFileToVFS("NotoSansDevanagari-Regular.ttf", fontBase64);
      doc.addFont("NotoSansDevanagari-Regular.ttf", "NotoSansDevanagari", "normal");
      doc.setFont("NotoSansDevanagari");

      const pageWidth = doc.internal.pageSize.getWidth();

      // Centered header text
      doc.setFontSize(14);
      doc.text(`श्री बैठक वाटप इतिहास - ${personName}`, pageWidth / 2, 15, { align: "center" });
      doc.setFontSize(10);
      doc.text(`कालावधी: ${formatDevnagariDate(historyStartDate)} ते ${formatDevnagariDate(historyEndDate)}`, pageWidth / 2, 22, { align: "center" });

      const columns = [
        "अनुक्रमांक",
        "दिनांक",
        "वार",
        "श्री बैठकीचे ठिकाण",
        "वेळ"
      ];

      const tableRows = historyRecords.map((record, index) => [
        toDevnagariNum(index + 1),
        formatDevnagariDate(record.scheduled_date),
        DAY_MARATHI[record.meeting_day] || record.meeting_day,
        record.place_name || "",
        formatTimeSlotMarathi(record.time_slot)
      ]);

      autoTable(doc, {
        startY: 28,
        head: [columns],
        body: tableRows,
        styles: {
          font: "NotoSansDevanagari",
          fontSize: 9,
          cellPadding: 2,
          lineColor: [0, 0, 0],
          lineWidth: 0.1,
          textColor: [0, 0, 0]
        },
        columnStyles: {
          0: { halign: "center", cellWidth: 20 },
          1: { halign: "center", cellWidth: 30 },
          2: { halign: "center", cellWidth: 25 },
          3: { halign: "left" },
          4: { halign: "center", cellWidth: 40 }
        },
        didParseCell: function (data) {
          data.cell.styles.font = "NotoSansDevanagari";
          if (data.section === "head") {
            data.cell.styles.fillColor = [0, 176, 80]; // standard green header
            data.cell.styles.textColor = [0, 0, 0];
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.halign = "center";
          }
        }
      });

      doc.save(`History_${personName}_${historyStartDate}_to_${historyEndDate}.pdf`);
    } catch (error) {
      console.error(error);
      alert("Failed to export history to PDF.");
    }
  };

  // Filter places based on Search and Selected Day
  const filteredPlaces = useMemo(() => {
    return places.filter(place => {
      const matchesDay = place.meeting_day === activeDay;
      const matchesSearch = searchQuery === "" || 
        place.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (schedules[Number(place.place_id)] !== undefined && schedules[Number(place.place_id)] !== null && people.find(p => Number(p.person_id) === Number(schedules[Number(place.place_id)]))?.name.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesDay && matchesSearch;
    });
  }, [places, activeDay, searchQuery, schedules, people]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center justify-center">
        <RefreshCw className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
        <p className="text-slate-500 text-sm">Connecting to Neon database...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      
      {/* Header bar */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200 transition-all">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <span className="font-semibold text-lg tracking-tight text-slate-900">Baithak Schedule</span>
            </div>

            {/* View Tabs */}
            <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200/60">
              <button
                onClick={() => setCurrentTab("schedule")}
                className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                  currentTab === "schedule"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-650 hover:text-slate-900"
                }`}
              >
                वेळापत्रक
              </button>
              <button
                onClick={() => setCurrentTab("history")}
                className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                  currentTab === "history"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-650 hover:text-slate-900"
                }`}
              >
                History
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Auto saving status indicator (Only relevant on schedule view) */}
            {currentTab === "schedule" && (
              <div className="text-sm flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-slate-650">
                {savingStatus === "saving" && (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 text-yellow-605 animate-spin" />
                    <span>Saving...</span>
                  </>
                )}
                {savingStatus === "saved" && (
                  <>
                    <Check className="w-3.5 h-3.5 text-green-600" />
                    <span className="text-green-600 font-medium">All Saved</span>
                  </>
                )}
                {savingStatus === "idle" && (
                  <>
                    <UserCheck className="w-3.5 h-3.5 text-slate-400" />
                    <span>Interactive Mode</span>
                  </>
                )}
                {savingStatus === "error" && (
                  <>
                    <AlertCircle className="w-3.5 h-3.5 text-red-650" />
                    <span className="text-red-605">Sync Error</span>
                  </>
                )}
              </div>
            )}
            
            {currentTab === "schedule" && (
              <button 
                onClick={() => setShowExportModal(true)} 
                className="flex items-center gap-2 h-9 px-4 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
            )}

            <button 
              onClick={handleLogout}
              className="flex items-center gap-2 h-9 px-4 rounded-full border border-slate-200 hover:bg-slate-50 text-slate-650 text-sm font-semibold transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              बाहेर पडा
            </button>
          </div>
        </div>
      </header>

      {/* Main Dashboard Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col gap-6">
        
        {/* Error alert toast */}
        {errorMessage && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-205 text-red-700 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-650 flex-shrink-0" />
            <div className="text-sm flex-1">{errorMessage}</div>
            <button onClick={() => setErrorMessage(null)} className="text-red-500 hover:text-red-700">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {currentTab === "schedule" ? (
          <>
            {/* Floating live out-of-cycle warning notice */}
            {warningMessage && (
              <motion.div 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 flex items-center gap-3 shadow-lg"
              >
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <div className="text-sm flex-1">{warningMessage}</div>
                <button onClick={() => setWarningMessage(null)} className="text-amber-600 hover:text-amber-800">
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            )}

            {/* Date Selector & Auto Schedule Controls */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs">
              <div className="flex flex-wrap items-center gap-3">
                <button 
                  onClick={() => handleWeekChange(-1)} 
                  className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 flex items-center justify-center text-slate-650 transition-colors cursor-pointer"
                  title="Previous Week"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                
                <div className={`relative flex items-center gap-2 px-4 py-2 rounded-xl border transition-all ${
                  isWeekFullyAllocated 
                    ? "bg-emerald-50 border-emerald-300 text-emerald-800 shadow-xs shadow-emerald-100/50" 
                    : "bg-slate-100 border-slate-200 text-slate-800"
                }`}>
                  <Calendar className={`w-4 h-4 transition-colors ${isWeekFullyAllocated ? 'text-emerald-600' : 'text-indigo-600'}`} />
                  <span className="font-semibold text-sm">
                    Week of {formatDateForDisplay(currentWeekStart)} – {weekEndDisplay}
                  </span>
                  <input 
                    type="date" 
                    onChange={handleDateSelect}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    value={weekStartStr}
                  />
                </div>

                <button 
                  onClick={() => handleWeekChange(1)} 
                  className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 flex items-center justify-center text-slate-650 transition-colors cursor-pointer"
                  title="Next Week"
                >
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button 
                  onClick={() => setCurrentWeekStart(getMonday(new Date()))} 
                  className="h-10 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-xs font-semibold text-slate-650 transition-colors cursor-pointer"
                >
                  Current Week
                </button>
              </div>

              <div className="flex items-center gap-3">
                <button 
                  onClick={handleAutoSchedule}
                  className="h-10 px-5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-650 border border-indigo-200 text-sm font-semibold flex items-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                >
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  Auto Schedule Week
                </button>

                <button 
                  onClick={handleClearSchedule}
                  className="h-10 px-4 rounded-xl bg-red-50 hover:bg-red-100 text-red-650 border border-red-200/60 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Clear Assignments
                </button>
              </div>
            </div>

            {/* Navigation Tabs and Search */}
            <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4">
              {/* Day Tabs */}
              <div className="flex p-1 bg-slate-100 rounded-xl border border-slate-200 overflow-x-auto">
                {DAYS_OF_WEEK.map((day) => {
                  const isAllocated = isDayFullyAllocated(day);
                  const isActive = activeDay === day;
                  return (
                    <button
                      key={day}
                      onClick={() => setActiveDay(day)}
                      className={`px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap border cursor-pointer ${
                        isActive
                          ? isAllocated
                            ? "bg-emerald-600 text-white shadow-sm border-emerald-700"
                            : "bg-white text-slate-900 shadow-xs border-slate-250"
                          : isAllocated
                            ? "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
                            : "text-slate-600 border-transparent hover:text-slate-900 hover:bg-slate-200/50"
                      }`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>

              {/* Search bar */}
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search meeting place or member name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-11 pl-10 pr-4 bg-white border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 rounded-xl text-sm transition-all text-slate-800 placeholder-slate-400 shadow-xs outline-none"
                />
              </div>
            </div>

            {/* Places & Allocations Grid */}
            <div className="relative">
              {weekLoading && (
                <div className="absolute inset-0 bg-white/40 backdrop-blur-[2px] z-20 flex items-center justify-center rounded-2xl">
                  <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
                </div>
              )}
              
              <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 transition-all duration-200 ${weekLoading ? 'opacity-40 pointer-events-none' : ''}`}>
              {filteredPlaces.length === 0 ? (
                <div className="col-span-full py-16 flex flex-col items-center justify-center rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-slate-500">
                  <Calendar className="w-8 h-8 text-slate-300 mb-3" />
                  <p className="text-sm font-medium">No places or active schedules found matching criteria.</p>
                </div>
              ) : (
                filteredPlaces.map((place) => {
                  const currentAssigneeId = schedules[place.place_id] || null;
                  
                  // 1. Filter candidates for this place based on gender rules:
                  const eligibleCandidates = people.filter(p => {
                    if (place.type === "MALE") {
                      return p.gender === "MALE";
                    }
                    return true; // Female place: MALE and FEMALE both allowed
                  });

                  // 2. Score candidates to show their statuses in the dropdown:
                  const candidateOptions = eligibleCandidates
                    .map(p => {
                      const personId = Number(p.person_id);
                      
                      // Same-day check (excluding current place)
                      const isAssignedOnSameDay = Object.entries(schedules).some(([otherPlaceIdStr, assignedPid]) => {
                        const otherPlaceId = Number(otherPlaceIdStr);
                        if (otherPlaceId === Number(place.place_id)) return false;
                        if (!assignedPid || Number(assignedPid) !== personId) return false;
                        
                        const otherPlace = places.find(pl => Number(pl.place_id) === otherPlaceId);
                        return otherPlace && otherPlace.meeting_day === place.meeting_day;
                      });

                      // Other-day check in same week (excluding current place)
                      const assignedElsewhereDays = Object.entries(schedules)
                        .map(([otherPlaceIdStr, assignedPid]) => {
                          if (!assignedPid || Number(assignedPid) !== personId) return null;
                          const otherPlaceId = Number(otherPlaceIdStr);
                          if (otherPlaceId === Number(place.place_id)) return null;
                          
                          const otherPlace = places.find(pl => Number(pl.place_id) === otherPlaceId);
                          return otherPlace && otherPlace.meeting_day !== place.meeting_day ? otherPlace.meeting_day : null;
                        })
                        .filter((d): d is typeof DAYS_OF_WEEK[number] => d !== null);

                      const lastScheduledWeek = historyMap.get(`${place.place_id}|${personId}`) || null;

                      return {
                        ...p,
                        isAssignedOnSameDay,
                        assignedElsewhereDays,
                        lastScheduledWeek
                      };
                    })
                    .filter(cand => !cand.isAssignedOnSameDay);

                  // Sort dropdown options:
                  candidateOptions.sort((a, b) => {
                    const aHasOther = a.assignedElsewhereDays.length > 0;
                    const bHasOther = b.assignedElsewhereDays.length > 0;

                    if (aHasOther && !bHasOther) return 1;
                    if (!aHasOther && bHasOther) return -1;
                    
                    const weekA = a.lastScheduledWeek || "1970-01-01";
                    const weekB = b.lastScheduledWeek || "1970-01-01";
                    return weekA.localeCompare(weekB);
                  });

                  const currentAssignee = people.find(p => Number(p.person_id) === Number(currentAssigneeId));

                  return (
                    <motion.div 
                      layout
                      key={place.place_id}
                      className="p-6 rounded-2xl bg-white border border-slate-200 hover:border-slate-300 shadow-xs hover:shadow-sm transition-all flex flex-col gap-4 relative group"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider mb-2 ${
                            place.type === "MALE" 
                              ? "bg-blue-50 text-blue-700 border border-blue-200" 
                              : "bg-pink-50 text-pink-700 border border-pink-200"
                          }`}>
                            {place.type} Group
                          </span>
                          <h3 className="font-semibold text-lg text-slate-800 group-hover:text-indigo-600 transition-colors">{place.name}</h3>
                        </div>
                        <div className="text-right text-xs text-slate-500 flex flex-col gap-1 font-medium">
                          <span>{place.meeting_day}</span>
                          <span>{TIME_SLOT_LABELS[place.time_slot].split(" ")[0]}</span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Assignee</label>
                        <div className="relative">
                          <select
                            value={currentAssigneeId !== null ? String(currentAssigneeId) : ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              handleAssignPerson(place.place_id, val ? Number(val) : null);
                            }}
                            className={`w-full h-11 px-4 pr-10 bg-slate-50 border focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 rounded-xl text-sm outline-none appearance-none transition-all cursor-pointer ${
                              currentAssigneeId 
                                ? "text-slate-800 border-slate-200 font-medium" 
                                : "text-slate-400 border-slate-200 font-normal italic"
                            }`}
                          >
                            <option value="">Unassigned</option>
                            {candidateOptions.map(cand => {
                              const statusLabels: string[] = [];
                              
                              if (cand.lastScheduledWeek) {
                                statusLabels.push(`Prev: ${formatDateForDisplay(parseLocalDate(cand.lastScheduledWeek))}`);
                              } else {
                                statusLabels.push("New");
                              }

                              const suffixLabel = cand.assignedElsewhereDays.length > 0
                                ? `(${cand.assignedElsewhereDays.join(", ")})`
                                : `(${cand.gender.charAt(0)})`;

                              return (
                                <option 
                                  key={cand.person_id} 
                                  value={String(cand.person_id)}
                                  className="bg-white text-slate-800"
                                >
                                  {cand.name} {suffixLabel} — {statusLabels.join(" | ")}
                                </option>
                              );
                            })}
                          </select>
                          <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        </div>
                      </div>

                      {/* Assignee Details & Quick Warnings */}
                      {currentAssignee && (
                        <div className="mt-2 p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-655">
                            {currentAssignee.gender === "MALE" ? "M" : "F"}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-xs text-slate-750 truncate">{currentAssignee.name}</div>
                            <div className="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5">
                              <span>Gender: {currentAssignee.gender}</span>
                              <span>•</span>
                              <span>Meetings this week: {currentWeekWorkloads[currentAssignee.person_id] || 0}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  );
                })
              )}
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Date Range & Person selector for History */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 p-6 rounded-2xl bg-white border border-slate-200 shadow-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 flex-1">
                
                {/* Person selector */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">सदस्य (Member)</label>
                  <div className="relative">
                    <select
                      value={selectedHistoryPersonId}
                      onChange={(e) => setSelectedHistoryPersonId(e.target.value)}
                      className="w-full h-10 px-3 pr-8 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none appearance-none transition-all cursor-pointer text-slate-800 focus:border-indigo-500 font-medium"
                    >
                      <option value="">सदस्य निवडा (Select Member)</option>
                      {people.map(p => (
                        <option key={p.person_id} value={String(p.person_id)} className="bg-white">
                          {p.name} ({p.gender === 'MALE' ? 'M' : 'F'})
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>

                {/* From Date */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">पासून दिनांक (From Date)</label>
                  <input 
                    type="date"
                    value={historyStartDate}
                    onChange={(e) => setHistoryStartDate(e.target.value)}
                    className="h-10 px-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 outline-none focus:border-indigo-500"
                  />
                </div>

                {/* To Date */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">पर्यंत दिनांक (To Date)</label>
                  <input 
                    type="date"
                    value={historyEndDate}
                    onChange={(e) => setHistoryEndDate(e.target.value)}
                    className="h-10 px-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 outline-none focus:border-indigo-500"
                  />
                </div>

              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button 
                  onClick={fetchPersonHistory}
                  disabled={historySearchLoading || !selectedHistoryPersonId}
                  className="h-10 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold flex items-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer disabled:opacity-50"
                >
                  {historySearchLoading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                  इतिहास शोधा (Search)
                </button>

                {historyRecords.length > 0 && (
                  <>
                    <button
                      onClick={handleHistoryExcelExport}
                      className="h-10 px-4 rounded-xl bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                      Excel डाउनलोड
                    </button>
                    <button
                      onClick={handleHistoryPdfExport}
                      className="h-10 px-4 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <FileText className="w-4 h-4" />
                      PDF डाउनलोड
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* History Table display */}
            <div className="relative flex-1">
              {historySearchLoading && (
                <div className="absolute inset-0 bg-white/40 backdrop-blur-[2px] z-20 flex items-center justify-center rounded-2xl">
                  <RefreshCw className="w-8 h-8 text-indigo-650 animate-spin" />
                </div>
              )}

              {!historyHasSearched ? (
                <div className="py-20 flex flex-col items-center justify-center rounded-2xl bg-white border border-slate-200 text-slate-500 shadow-xs">
                  <Calendar className="w-12 h-12 text-slate-300 mb-3" />
                  <p className="text-sm font-medium">सदस्याची माहिती मिळवण्यासाठी वरील पर्याय निवडून "इतिहास शोधा" बटणावर क्लिक करा.</p>
                </div>
              ) : historyRecords.length === 0 ? (
                <div className="py-20 flex flex-col items-center justify-center rounded-2xl bg-white border border-slate-200 text-slate-500 shadow-xs">
                  <Search className="w-12 h-12 text-slate-350 mb-3" />
                  <p className="text-sm font-medium">निवडलेल्या कालावधीत कोणताही इतिहास सापडला नाही.</p>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-650 text-xs font-bold uppercase">
                          <th className="px-6 py-4 text-center w-24">अनुक्रमांक (S.No.)</th>
                          <th className="px-6 py-4">दिनांक (Date)</th>
                          <th className="px-6 py-4">वार (Day)</th>
                          <th className="px-6 py-4">श्री बैठकीचे ठिकाण (Meeting Place)</th>
                          <th className="px-6 py-4">वेळ (Time Slot)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
                        {historyRecords.map((record, index) => {
                          return (
                            <tr key={record.schedule_id} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-6 py-3.5 text-center font-semibold text-slate-500">
                                {toDevnagariNum(index + 1)}
                              </td>
                              <td className="px-6 py-3.5 font-medium">
                                {formatDevnagariDate(record.scheduled_date)}
                              </td>
                              <td className="px-6 py-3.5">
                                {DAY_MARATHI[record.meeting_day] || record.meeting_day}
                              </td>
                              <td className="px-6 py-3.5 font-semibold text-indigo-650">
                                {record.place_name}
                              </td>
                              <td className="px-6 py-3.5 text-slate-600">
                                {formatTimeSlotMarathi(record.time_slot)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* Range Export Modal Dialog */}
      <AnimatePresence>
        {showExportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowExportModal(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-xs"
            />
            
            {/* Modal Body */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-md bg-white border border-slate-200 p-6 rounded-2xl shadow-2xl relative z-10"
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-bold text-lg text-slate-900">Export Schedule Reports</h3>
                <button 
                  onClick={() => setShowExportModal(false)}
                  className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-800 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-col gap-5">
                {/* Single Week Export Shortcut */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col gap-3">
                  <h4 className="text-xs font-bold text-slate-50 uppercase tracking-wider">Option 1: Export Current Week</h4>
                  <p className="text-xs text-slate-400">Export only the active selected week ({formatDateForDisplay(currentWeekStart)}).</p>
                  
                  <div className="grid grid-cols-3 gap-3 mt-1">
                    <button
                      onClick={() => handleExcelExport(false)}
                      disabled={exportLoading}
                      className="h-10 rounded-xl bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                      Excel File
                    </button>
                    
                    <button
                      onClick={() => handlePdfExport(false)}
                      disabled={exportLoading}
                      className="h-10 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <FileText className="w-4 h-4" />
                      PDF File
                    </button>

                    <button
                      onClick={() => handleChityaExcelExport(false)}
                      disabled={exportLoading}
                      className="h-10 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                      Chitya
                    </button>
                  </div>
                </div>

                {/* Range Export Section */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col gap-4">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Option 2: Export Custom Range</h4>
                  <p className="text-xs text-slate-400">Consolidate multiple weeks into a single report.</p>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-semibold text-slate-450 uppercase">From Date</label>
                      <input 
                        type="date"
                        value={exportStartDate}
                        onChange={(e) => setExportStartDate(e.target.value)}
                        className="h-10 px-3 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 outline-none focus:border-indigo-500"
                      />
                    </div>
                    
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-semibold text-slate-450 uppercase">To Date</label>
                      <input 
                        type="date"
                        value={exportEndDate}
                        onChange={(e) => setExportEndDate(e.target.value)}
                        className="h-10 px-3 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mt-1">
                    <button
                      onClick={() => handleExcelExport(true)}
                      disabled={exportLoading}
                      className="h-10 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {exportLoading ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <FileSpreadsheet className="w-4 h-4" />
                      )}
                      Export Excel
                    </button>
                    
                    <button
                      onClick={() => handlePdfExport(true)}
                      disabled={exportLoading}
                      className="h-10 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {exportLoading ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <FileText className="w-4 h-4" />
                      )}
                      Export PDF
                    </button>

                    <button
                      onClick={() => handleChityaExcelExport(true)}
                      disabled={exportLoading}
                      className="h-10 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {exportLoading ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <FileSpreadsheet className="w-4 h-4" />
                      )}
                      Export Chitya
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
