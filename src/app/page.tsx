"use client";

import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ArrowLeft, ArrowRight, Calendar, Sparkles, Check, AlertCircle, 
  RotateCcw, Download, FileSpreadsheet, FileText, ChevronDown, 
  Search, RefreshCw, AlertTriangle, UserCheck, X
} from "lucide-react";
import * as XLSX from "xlsx";
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
  EARLY_EVENING: "Early Evening (संध्याकाळी लवकर)",
  LATE_EVENING: "Late Evening (रात्री उशिरा)",
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
  const baseDate = new Date(baseDateStr);
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
  
  // Loading & Action states
  const [loading, setLoading] = useState<boolean>(true);
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
        setSavingStatus("idle");
        const [schedRes, histRes] = await Promise.all([
          fetch(`/api/schedule?week_start_date=${weekStartStr}`).then(r => r.json()),
          fetch("/api/schedule/history").then(r => r.json())
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
      } catch (err) {
        console.error("Failed to load week schedules", err);
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
      workloads[p.person_id] = 0;
    });
    Object.values(schedules).forEach(pid => {
      if (pid) workloads[pid] = (workloads[pid] || 0) + 1;
    });
    return workloads;
  }, [schedules, people]);

  // Perform a local schedule save (optimistic background sync)
  const saveScheduleToDb = async (updatedSchedules: Record<number, number | null>) => {
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
      setCurrentWeekStart(getMonday(new Date(e.target.value)));
    }
  };

  // Change individual assignment
  const handleAssignPerson = (placeId: number, personId: number | null) => {
    const previousAssignment = schedules[placeId];
    const newSchedules = { ...schedules, [placeId]: personId };
    
    // Perform double-booking validation on the client instantly
    if (personId) {
      const place = places.find(p => p.place_id === placeId);
      if (place) {
        // Find if this person is already assigned elsewhere at the same time
        const doubleBooked = Object.entries(newSchedules).find(([pIdStr, assignedPid]) => {
          const pId = Number(pIdStr);
          if (pId === placeId || assignedPid !== personId) return false;
          
          const otherPlace = places.find(p => p.place_id === pId);
          return otherPlace && 
            otherPlace.meeting_day === place.meeting_day && 
            otherPlace.time_slot === place.time_slot;
        });

        if (doubleBooked) {
          const otherPlace = places.find(p => p.place_id === Number(doubleBooked[0]));
          alert(`Conflict! ${people.find(p => p.person_id === personId)?.name} is already scheduled to "${otherPlace?.name}" at the same day & time (${place.meeting_day} ${TIME_SLOT_LABELS[place.time_slot]}).`);
          return;
        }

        // Show out-of-cycle warnings in the UI dynamically (as a non-blocking toast/notice)
        const lastWeek = historyMap.get(`${placeId}|${personId}`);
        if (lastWeek) {
          // Verify if there are other eligible people who have NEVER been scheduled here
          const eligiblePeople = people.filter(p => place.type === "FEMALE" || p.gender === "MALE");
          const anyNeverScheduled = eligiblePeople.some(p => !historyMap.has(`${placeId}|${p.person_id}`));
          
          if (anyNeverScheduled) {
            setWarningMessage(`${people.find(p => p.person_id === personId)?.name} was previously scheduled to this place in Week of ${lastWeek}. Other eligible candidates have not been scheduled here yet in this cycle!`);
            // Auto hide warning message after 5 seconds
            setTimeout(() => setWarningMessage(null), 8000);
          }
        }
      }
    }

    setSchedules(newSchedules);
    saveScheduleToDb(newSchedules);
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
      saveScheduleToDb(map);
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
        let start = new Date(exportStartDate);
        const end = new Date(exportEndDate);
        
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

      // Map rows for Excel
      const rows = dataToExport.map((item: any) => ({
        "Week Start Date": formatDateForDisplay(new Date(item.week_start_date)),
        "Scheduled Date": formatDateForDisplay(new Date(item.scheduled_date)),
        "Day": item.meeting_day,
        "Time Slot": TIME_SLOT_LABELS[item.time_slot] || item.time_slot,
        "Meeting Place": item.place_name,
        "Audience Type": item.place_type,
        "Assigned Member": item.person_name || "Unassigned",
        "Member Gender": item.person_gender || "-"
      }));

      // Generate spreadsheet
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Schedules");
      
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

  // EXPORT TO PDF
  const handlePdfExport = async (isRange: boolean) => {
    try {
      setExportLoading(true);
      let dataToExport: any[] = [];

      if (!isRange) {
        const res = await fetch(`/api/schedule?week_start_date=${weekStartStr}`).then(r => r.json());
        dataToExport = res;
      } else {
        let start = new Date(exportStartDate);
        const end = new Date(exportEndDate);
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

      // Generate PDF
      const doc = new jsPDF();
      doc.text("Meeting Schedules Report", 14, 15);
      
      const dateLabel = isRange 
        ? `Period: ${formatDateForDisplay(new Date(exportStartDate))} to ${formatDateForDisplay(new Date(exportEndDate))}`
        : `Week of: ${formatDateForDisplay(new Date(weekStartStr))}`;
      
      doc.setFontSize(10);
      doc.text(dateLabel, 14, 22);

      const tableData = dataToExport.map((item: any) => [
        formatDateForDisplay(new Date(item.scheduled_date)),
        item.meeting_day,
        item.place_name,
        item.place_type,
        TIME_SLOT_LABELS[item.time_slot] || item.time_slot,
        item.person_name || "Unassigned"
      ]);

      autoTable(doc, {
        startY: 28,
        head: [["Date", "Day", "Place", "Type", "Time Slot", "Assigned Member"]],
        body: tableData,
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

  // Filter places based on Search and Selected Day
  const filteredPlaces = useMemo(() => {
    return places.filter(place => {
      const matchesDay = place.meeting_day === activeDay;
      const matchesSearch = searchQuery === "" || 
        place.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (schedules[place.place_id] && people.find(p => p.person_id === schedules[place.place_id])?.name.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesDay && matchesSearch;
    });
  }, [places, activeDay, searchQuery, schedules, people]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center">
        <RefreshCw className="w-12 h-12 text-indigo-500 animate-spin mb-4" />
        <p className="text-muted-foreground text-sm">Connecting to Neon database...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-sans">
      
      {/* Header bar */}
      <header className="sticky top-0 z-40 bg-zinc-950/70 backdrop-blur-md border-b border-zinc-800 transition-all">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-lg tracking-tight">Baitha 2.0 Meeting Scheduler</span>
          </div>

          <div className="flex items-center gap-4">
            {/* Auto saving status indicator */}
            <div className="text-sm flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400">
              {savingStatus === "saving" && (
                <>
                  <RefreshCw className="w-3.5 h-3.5 text-yellow-500 animate-spin" />
                  <span>Saving...</span>
                </>
              )}
              {savingStatus === "saved" && (
                <>
                  <Check className="w-3.5 h-3.5 text-green-500" />
                  <span className="text-green-500 font-medium">All Saved</span>
                </>
              )}
              {savingStatus === "idle" && (
                <>
                  <UserCheck className="w-3.5 h-3.5 text-zinc-500" />
                  <span>Interactive Mode</span>
                </>
              )}
              {savingStatus === "error" && (
                <>
                  <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                  <span className="text-red-500">Sync Error</span>
                </>
              )}
            </div>
            
            <button 
              onClick={() => setShowExportModal(true)} 
              className="flex items-center gap-2 h-9 px-4 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
          </div>
        </div>
      </header>

      {/* Main Dashboard Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col gap-6">
        
        {/* Error alert toast */}
        {errorMessage && (
          <div className="p-4 rounded-xl bg-red-950/40 border border-red-900 text-red-200 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <div className="text-sm flex-1">{errorMessage}</div>
            <button onClick={() => setErrorMessage(null)} className="text-red-400 hover:text-red-200">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Floating live out-of-cycle warning notice */}
        {warningMessage && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="p-4 rounded-xl bg-yellow-950/40 border border-yellow-900 text-yellow-200 flex items-center gap-3 shadow-lg"
          >
            <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
            <div className="text-sm flex-1">{warningMessage}</div>
            <button onClick={() => setWarningMessage(null)} className="text-yellow-400 hover:text-yellow-200">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}

        {/* Date Selector & Auto Schedule Controls */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 backdrop-blur-sm">
          <div className="flex flex-wrap items-center gap-3">
            <button 
              onClick={() => handleWeekChange(-1)} 
              className="w-10 h-10 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 flex items-center justify-center text-zinc-300 transition-colors"
              title="Previous Week"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            
            <div className="relative flex items-center gap-2 bg-zinc-950 px-4 py-2 rounded-xl border border-zinc-850">
              <Calendar className="w-4 h-4 text-indigo-400" />
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
              className="w-10 h-10 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 flex items-center justify-center text-zinc-300 transition-colors"
              title="Next Week"
            >
              <ArrowRight className="w-4 h-4" />
            </button>

            <button 
              onClick={() => setCurrentWeekStart(getMonday(new Date()))} 
              className="h-10 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-zinc-350 transition-colors"
            >
              Current Week
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={handleAutoSchedule}
              className="h-10 px-5 rounded-xl bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/20 text-sm font-semibold flex items-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <Sparkles className="w-4 h-4 text-indigo-400" />
              Auto Schedule Week
            </button>

            <button 
              onClick={handleClearSchedule}
              className="h-10 px-4 rounded-xl bg-red-950/20 hover:bg-red-950/40 text-red-400 border border-red-900/30 text-xs font-semibold flex items-center gap-2 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Clear Assignments
            </button>
          </div>
        </div>

        {/* Navigation Tabs and Search */}
        <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4">
          {/* Day Tabs */}
          <div className="flex p-1 bg-zinc-950 rounded-xl border border-zinc-850 overflow-x-auto">
            {DAYS_OF_WEEK.map((day) => (
              <button
                key={day}
                onClick={() => setActiveDay(day)}
                className={`px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
                  activeDay === day 
                    ? "bg-zinc-800 text-white shadow-sm" 
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {day}
              </button>
            ))}
          </div>

          {/* Search bar */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Search meeting place or member name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-11 pl-10 pr-4 bg-zinc-900/40 focus:bg-zinc-900/70 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 rounded-xl text-sm transition-all text-zinc-200 placeholder-zinc-500 outline-none"
            />
          </div>
        </div>

        {/* Places & Allocations Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPlaces.length === 0 ? (
            <div className="col-span-full py-16 flex flex-col items-center justify-center rounded-2xl bg-zinc-900/20 border border-dashed border-zinc-800 text-zinc-500">
              <Calendar className="w-8 h-8 text-zinc-600 mb-3" />
              <p className="text-sm font-medium">No places or active schedules found matching criteria.</p>
            </div>
          ) : (
            filteredPlaces.map((place) => {
              const currentAssigneeId = schedules[place.place_id] || null;
              
              // 1. Filter candidates for this place based on gender rules:
              // "Male is allowed for both Male and female but female is allowed for female only"
              const eligibleCandidates = people.filter(p => {
                if (place.type === "MALE") {
                  return p.gender === "MALE";
                }
                return true; // Female place: MALE and FEMALE both allowed
              });

              // 2. Score candidates to show their statuses in the dropdown:
              // - Double-booked: if booked elsewhere on this day & time-slot.
              // - Last scheduled week
              const candidateOptions = eligibleCandidates.map(p => {
                const personId = p.person_id;
                
                // Double booked check
                const isDoubleBooked = Object.entries(schedules).some(([otherPlaceIdStr, assignedPid]) => {
                  const otherPlaceId = Number(otherPlaceIdStr);
                  if (otherPlaceId === place.place_id || assignedPid !== personId) return false;
                  
                  const otherPlace = places.find(pl => pl.place_id === otherPlaceId);
                  return otherPlace && 
                    otherPlace.meeting_day === place.meeting_day && 
                    otherPlace.time_slot === place.time_slot;
                });

                const lastScheduledWeek = historyMap.get(`${place.place_id}|${personId}`) || null;

                return {
                  ...p,
                  isDoubleBooked,
                  lastScheduledWeek
                };
              });

              // Sort dropdown options:
              // - Available and Never Scheduled first
              // - Available and Scheduled longest ago second
              // - Double-booked last
              candidateOptions.sort((a, b) => {
                if (a.isDoubleBooked && !b.isDoubleBooked) return 1;
                if (!a.isDoubleBooked && b.isDoubleBooked) return -1;
                
                const weekA = a.lastScheduledWeek || "1970-01-01";
                const weekB = b.lastScheduledWeek || "1970-01-01";
                return weekA.localeCompare(weekB);
              });

              const currentAssignee = people.find(p => p.person_id === currentAssigneeId);

              return (
                <motion.div 
                  layout
                  key={place.place_id}
                  className="p-6 rounded-2xl bg-zinc-900/30 border border-zinc-800/80 hover:border-zinc-700/80 transition-all flex flex-col gap-4 relative group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider mb-2 ${
                        place.type === "MALE" 
                          ? "bg-blue-950/40 text-blue-400 border border-blue-900/30" 
                          : "bg-pink-950/40 text-pink-400 border border-pink-900/30"
                      }`}>
                        {place.type} Group
                      </span>
                      <h3 className="font-semibold text-lg text-zinc-100 group-hover:text-white transition-colors">{place.name}</h3>
                    </div>
                    <div className="text-right text-xs text-zinc-550 flex flex-col gap-1 font-medium">
                      <span>{place.meeting_day}</span>
                      <span>{TIME_SLOT_LABELS[place.time_slot].split(" ")[0]}</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Assignee</label>
                    <div className="relative">
                      <select
                        value={currentAssigneeId || ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          handleAssignPerson(place.place_id, val ? Number(val) : null);
                        }}
                        className={`w-full h-11 px-4 pr-10 bg-zinc-950 border focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 rounded-xl text-sm outline-none appearance-none transition-all cursor-pointer ${
                          currentAssigneeId 
                            ? "text-zinc-200 border-zinc-850 font-medium" 
                            : "text-zinc-500 border-zinc-900 font-normal italic"
                        }`}
                      >
                        <option value="">Unassigned (कोणीही नाही)</option>
                        {candidateOptions.map(cand => {
                          const statusLabels: string[] = [];
                          if (cand.isDoubleBooked) statusLabels.push("Double Booked!");
                          if (cand.lastScheduledWeek) {
                            statusLabels.push(`Prev: ${formatDateForDisplay(new Date(cand.lastScheduledWeek))}`);
                          } else {
                            statusLabels.push("Priority: New");
                          }

                          return (
                            <option 
                              key={cand.person_id} 
                              value={cand.person_id}
                              disabled={cand.isDoubleBooked}
                              className="bg-zinc-950 text-zinc-200 disabled:text-zinc-700"
                            >
                              {cand.name} ({cand.gender.charAt(0)}) — {statusLabels.join(" | ")}
                            </option>
                          );
                        })}
                      </select>
                      <ChevronDown className="w-4 h-4 text-zinc-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>

                  {/* Assignee Details & Quick Warnings */}
                  {currentAssignee && (
                    <div className="mt-2 p-3.5 rounded-xl bg-zinc-950/40 border border-zinc-850 flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-indigo-950 border border-indigo-900 flex items-center justify-center text-xs font-bold text-indigo-400">
                        {currentAssignee.gender === "MALE" ? "M" : "F"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-xs text-zinc-250 truncate">{currentAssignee.name}</div>
                        <div className="text-[10px] text-zinc-500 flex items-center gap-2 mt-0.5">
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
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            
            {/* Modal Body */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-md bg-zinc-950 border border-zinc-850 p-6 rounded-2xl shadow-2xl relative z-10"
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-bold text-lg text-white">Export Schedule Reports</h3>
                <button 
                  onClick={() => setShowExportModal(false)}
                  className="p-1 rounded-lg hover:bg-zinc-900 text-zinc-400 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-col gap-5">
                {/* Single Week Export Shortcut */}
                <div className="p-4 rounded-xl bg-zinc-900/30 border border-zinc-850 flex flex-col gap-3">
                  <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Option 1: Export Current Week</h4>
                  <p className="text-xs text-zinc-500">Export only the active selected week ({formatDateForDisplay(currentWeekStart)}).</p>
                  
                  <div className="grid grid-cols-2 gap-3 mt-1">
                    <button
                      onClick={() => handleExcelExport(false)}
                      disabled={exportLoading}
                      className="h-10 rounded-xl bg-green-600/10 hover:bg-green-600/20 text-green-400 border border-green-500/20 text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                      Excel File
                    </button>
                    
                    <button
                      onClick={() => handlePdfExport(false)}
                      disabled={exportLoading}
                      className="h-10 rounded-xl bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-500/20 text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                    >
                      <FileText className="w-4 h-4" />
                      PDF File
                    </button>
                  </div>
                </div>

                {/* Range Export Section */}
                <div className="p-4 rounded-xl bg-zinc-900/30 border border-zinc-850 flex flex-col gap-4">
                  <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Option 2: Export Custom Range</h4>
                  <p className="text-xs text-zinc-500">Consolidate multiple weeks into a single report.</p>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-semibold text-zinc-500 uppercase">From Date</label>
                      <input 
                        type="date"
                        value={exportStartDate}
                        onChange={(e) => setExportStartDate(e.target.value)}
                        className="h-10 px-3 bg-zinc-950 border border-zinc-850 rounded-xl text-xs text-zinc-200 outline-none focus:border-indigo-500"
                      />
                    </div>
                    
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-semibold text-zinc-500 uppercase">To Date</label>
                      <input 
                        type="date"
                        value={exportEndDate}
                        onChange={(e) => setExportEndDate(e.target.value)}
                        className="h-10 px-3 bg-zinc-950 border border-zinc-850 rounded-xl text-xs text-zinc-200 outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mt-1">
                    <button
                      onClick={() => handleExcelExport(true)}
                      disabled={exportLoading}
                      className="h-10 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
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
                      className="h-10 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                    >
                      {exportLoading ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <FileText className="w-4 h-4" />
                      )}
                      Export PDF
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
