import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, useSpring } from 'motion/react';
import Markdown from 'react-markdown';
import { BookOpen, CheckCircle, CircleDashed, FileText, Loader2, ShieldCheck, UserCog, Send, AlertTriangle, UploadCloud, Sparkles, Sun, Moon, RotateCcw, Download, Check, X, ArrowUp, RefreshCw, Maximize, Minimize } from 'lucide-react';
import { runAgent1, runAgent2, calculateDefenseScore } from './services/gemini';
import * as mammoth from 'mammoth';
import { Document, Packer, Paragraph, TextRun } from 'docx';
// @ts-ignore
import avanteLogo from './assets/images/avante_logo_1782161351689.jpg';

function GoogleDownloadIcon({ size = 18 }: { size?: number }) {
  return (
    <span className="relative flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="overflow-hidden"
      >
        <motion.g
          variants={{
            hover: {
              y: [0, 6, -10, 0],
              opacity: [1, 0, 0, 1],
              transition: {
                times: [0, 0.4, 0.45, 1],
                duration: 0.75,
                ease: "easeInOut",
              }
            },
            tap: {
              y: 4,
              transition: { type: "spring", stiffness: 300, damping: 12 }
            }
          }}
        >
          <line x1="12" x2="12" y1="15" y2="3" />
          <polyline points="7 10 12 15 17 10" />
        </motion.g>
        <motion.path
          d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
          variants={{
            hover: {
              y: [0, 1, -0.5, 0],
              scaleX: [1, 1.1, 0.95, 1],
              transition: {
                times: [0, 0.3, 0.7, 1],
                duration: 0.75,
                ease: "easeInOut",
              }
            },
            tap: {
              y: 2,
              scaleX: 1.1,
              transition: { type: "spring", stiffness: 300, damping: 12 }
            }
          }}
          style={{ transformOrigin: "bottom center" }}
        />
      </svg>
    </span>
  );
}

type AgentState = 'idle' | 'running' | 'completed' | 'error';
type CorrectionStatus = 'pending' | 'accepted' | 'rejected';

interface Correction {
  id: string;
  location: string;
  original: string;
  corrected: string;
  reasoning: string;
  status: CorrectionStatus;
}

function cleanAgentMarkdown(markdown: string): string {
  if (!markdown) return '';
  const lowerText = markdown.toLowerCase();
  const correctionIndex = lowerText.indexOf('<correction');
  
  let cleaned = markdown;
  if (correctionIndex !== -1) {
    let cutoff = correctionIndex;
    const beforeText = markdown.substring(0, correctionIndex);
    const lastCodeFence = beforeText.lastIndexOf('```');
    if (lastCodeFence !== -1 && lastCodeFence > beforeText.length - 100) {
      cutoff = lastCodeFence;
    }
    
    const headerRxs = [
      /###?\s*mandatory/i,
      /###?\s*corrections/i,
      /###?\s*dean's/i,
      /###?\s*pointers/i,
      /###?\s*scribe's/i,
      /###?\s*suggested/i,
      /###?\s*audit/i
    ];
    let earliestHeaderIndex = -1;
    for (const rx of headerRxs) {
      const match = rx.exec(beforeText);
      if (match && (earliestHeaderIndex === -1 || match.index < earliestHeaderIndex)) {
        if (match.index > beforeText.length - 300) {
          earliestHeaderIndex = match.index;
        }
      }
    }
    
    if (earliestHeaderIndex !== -1) {
      cutoff = earliestHeaderIndex;
    }
    
    cleaned = markdown.substring(0, cutoff).trim();
  }

  // Strip residual XML segments and HTML tags
  cleaned = cleaned.replace(/<correction>[\s\S]*?<\/correction>/gi, '');
  cleaned = cleaned.replace(/<\/?[a-zA-Z]+>/g, '');
  cleaned = cleaned.replace(/```[a-zA-Z]*/g, '');
  return cleaned.trim();
}

export default function App() {
  const [thesis, setThesis] = useState('');
  const [agent1State, setAgent1State] = useState<AgentState>('idle');
  const [agent2State, setAgent2State] = useState<AgentState>('idle');
  const [agent1Output, setAgent1Output] = useState('');
  const [agent2Output, setAgent2Output] = useState('');
  const [agent1Corrections, setAgent1Corrections] = useState<Correction[]>([]);
  const [agent2Corrections, setAgent2Corrections] = useState<Correction[]>([]);
  const [agent2Phase, setAgent2Phase] = useState<1 | 2>(1);
  const [agent2ScoreCalculated, setAgent2ScoreCalculated] = useState(false);
  const [isCalculatingScore, setIsCalculatingScore] = useState(false);
  const [activeTab, setActiveTab] = useState<'agent1' | 'agent2'>('agent1');
  const [errorMsg, setErrorMsg] = useState('');
  const [wittyError, setWittyError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [lastAcceptedCorrection, setLastAcceptedCorrection] = useState<Correction | null>(null);
  const [activeSpotlight, setActiveSpotlight] = useState<Correction | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const mirroredRef = useRef<HTMLDivElement>(null);

  // Dynamically resolve the most up-to-date state of the active spotlight card
  const liveActiveSpotlight = useMemo(() => {
    if (!activeSpotlight) return null;
    const found1 = agent1Corrections.find(c => c.id === activeSpotlight.id);
    if (found1) return found1;
    const found2 = agent2Corrections.find(c => c.id === activeSpotlight.id);
    if (found2) return found2;
    return activeSpotlight;
  }, [activeSpotlight, agent1Corrections, agent2Corrections]);

  // Sync scroll positions between the textarea and the mirrored overlay
  const handleEditorScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (mirroredRef.current) {
      mirroredRef.current.scrollTop = e.currentTarget.scrollTop;
      mirroredRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  // Helper to extract a robust match from the source string, allowing flexible whitespace variations
  const getMatchInfo = useMemo(() => {
    if (!liveActiveSpotlight || !thesis) return null;
    
    const tryMatch = (searchStr: string): { index: number; length: number } | null => {
      if (!searchStr) return null;
      
      const cleanSearch = searchStr.trim();
      if (!cleanSearch) return null;

      // Stage 1: Exact Match (Case Sensitive)
      let idx = thesis.indexOf(cleanSearch);
      if (idx !== -1) return { index: idx, length: cleanSearch.length };
      
      // Stage 2: Case Insensitive Exact Match
      const lowerThesis = thesis.toLowerCase();
      const lowerSearch = cleanSearch.toLowerCase();
      idx = lowerThesis.indexOf(lowerSearch);
      if (idx !== -1) return { index: idx, length: cleanSearch.length };
      
      // Stage 3: Quote & Whitespace Flexible Regex Match (Robust against variations in quotes, newlines, and space sequences)
      // Matches directly in the RAW thesis string, avoiding index-mismatch errors
      const makeFlexibleRegex = (searchStr: string): RegExp | null => {
        try {
          const escaped = searchStr
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
            .replace(/['`’‘]/g, "['`’‘]")           // Match any apostrophe/single quote variation
            .replace(/[“”"„]/g, '["“”„]')           // Match any double quote variation
            .replace(/\s+/g, '\\s+');                // Match any sequence of whitespaces or newlines
          return new RegExp(escaped, 'i');
        } catch (e) {
          return null;
        }
      };

      const regexQuotesSpaces = makeFlexibleRegex(cleanSearch);
      if (regexQuotesSpaces) {
        const match = thesis.match(regexQuotesSpaces);
        if (match && match.index !== undefined) {
          return { index: match.index, length: match[0].length };
        }
      }

      // Stage 4: Token-based Regex (Robust against arbitrary spaces, punctuations, and line breaks)
      const tokens = cleanSearch.replace(/[^\w\s]/gi, '').split(/\s+/).filter(t => t.length > 0);
      if (tokens.length > 0) {
        const flexibleRegexStr = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\W_]+');
        try {
          const regex = new RegExp(flexibleRegexStr, 'i');
          const match = thesis.match(regex);
          if (match && match.index !== undefined) {
            return { index: match.index, length: match[0].length };
          }
        } catch (e) {
          // ignore regex errors
        }
      }

      // Stage 5: Anchor head/tail subset match (for long strings)
      if (cleanSearch.length > 20) {
        // Try matching first 15 chars + wildcard + last 15 chars
        const head = cleanSearch.substring(0, 15).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const tail = cleanSearch.substring(cleanSearch.length - 15).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        try {
          const regex = new RegExp(`${head}[\\s\\S]{1,1000}?${tail}`, 'i');
          const match = thesis.match(regex);
          if (match && match.index !== undefined) {
            return { index: match.index, length: match[0].length };
          }
        } catch (e) {}
      }

      // Stage 6: Multi-word sliding sub-match (try matching subsets of consecutive words)
      if (tokens.length >= 3) {
        for (let i = 0; i <= tokens.length - 3; i++) {
          const subRegexStr = tokens.slice(i, i + 3).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\W_]+');
          try {
            const regex = new RegExp(subRegexStr, 'i');
            const match = thesis.match(regex);
            if (match && match.index !== undefined) {
              return { index: match.index, length: match[0].length };
            }
          } catch (e) {}
        }
      }

      // Stage 7: Single unique word anchor fallback
      const sortedTokens = [...tokens].sort((a, b) => b.length - a.length);
      for (const token of sortedTokens) {
        if (token.length >= 4) {
          const tokenRegexStr = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          try {
            const idxRegex = thesis.search(new RegExp(`\\b${tokenRegexStr}\\b`, 'i'));
            if (idxRegex !== -1) {
              return { index: idxRegex, length: token.length };
            }
          } catch (e) {}
          idx = lowerThesis.indexOf(token.toLowerCase());
          if (idx !== -1) {
            return { index: idx, length: token.length };
          }
        }
      }

      // Stage 8: Default fallback to first 10 characters
      if (cleanSearch.length >= 8) {
        const fallbackStr = cleanSearch.substring(0, 8);
        idx = lowerThesis.indexOf(fallbackStr.toLowerCase());
        if (idx !== -1) {
          return { index: idx, length: fallbackStr.length };
        }
      }

      return null;
    };

    const targetSearchStr = liveActiveSpotlight.status === 'accepted' ? liveActiveSpotlight.corrected : liveActiveSpotlight.original;
    const targetLocationStr = liveActiveSpotlight.status === 'accepted'
      ? liveActiveSpotlight.location.replace(liveActiveSpotlight.original, liveActiveSpotlight.corrected)
      : liveActiveSpotlight.location;

    let match = tryMatch(targetSearchStr);
    if (!match) {
        match = tryMatch(targetLocationStr);
    }
    return match;
  }, [thesis, liveActiveSpotlight]);

  const renderMirroredText = () => {
    if (!liveActiveSpotlight || !getMatchInfo) {
      return null;
    }

    const before = thesis.substring(0, getMatchInfo.index);
    const match = thesis.substring(getMatchInfo.index, getMatchInfo.index + getMatchInfo.length);
    const after = thesis.substring(getMatchInfo.index + getMatchInfo.length);

    // Color classes depending on status:
    let bgHighlightClass = '';
    let textClass = '';
    let borderClass = '';
    let shadowClass = '';

    if (liveActiveSpotlight.status === 'accepted') {
      bgHighlightClass = 'bg-emerald-500/40 dark:bg-emerald-500/45';
      textClass = 'text-emerald-950 dark:text-emerald-50';
      borderClass = 'border-b-2 border-emerald-500/80';
      shadowClass = 'shadow-[0_0_15px_rgba(16,185,129,0.5)]';
    } else if (liveActiveSpotlight.status === 'rejected') {
      bgHighlightClass = 'bg-amber-500/49 dark:bg-amber-500/54';
      textClass = 'text-amber-900 dark:text-amber-100 font-bold';
      borderClass = 'border-b-2 border-amber-500/70';
      shadowClass = 'shadow-[0_0_15px_rgba(245,158,11,0.6)]';
    } else {
      // Pending
      bgHighlightClass = 'bg-blue-600/40 dark:bg-blue-500/45';
      textClass = 'text-blue-950 dark:text-blue-50';
      borderClass = 'border-b-2 border-blue-500/80';
      shadowClass = 'shadow-[0_0_15px_rgba(59,130,246,0.5)]';
    }

    return (
      <>
        <span className="text-slate-600 dark:text-slate-600 opacity-30 filter blur-[1px] transition-all duration-300">{before}</span>
        <span 
          id="spotlight-match" 
          className={`px-0.5 rounded-[4px] font-semibold transition-all duration-300 relative inline z-10 scale-[1.03] origin-center ${bgHighlightClass} ${textClass} ${borderClass} ${shadowClass}`}
        >
          {match}
        </span>
        <span className="text-slate-600 dark:text-slate-600 opacity-30 filter blur-[1px] transition-all duration-300">{after}</span>
      </>
    );
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setThesis(e.target.value);
    if (activeSpotlight) setActiveSpotlight(null);
    if (e.target.value.trim() && showGuidance) {
      setShowGuidance(false);
      setGuidanceTrigger(null);
      setAgent1IdleMessage("Hey Flam, ready when you are! What thesis are we roasting today? 🧐 Simply drag & drop your file into the white box, paste directly, or use the upload button, and I’ll get grinding.");
    }
  };

  // ... rest of component logic ...

  useEffect(() => {
    if (lastAcceptedCorrection && textareaRef.current) {
      // Find the new index of the corrected text
      const index = thesis.indexOf(lastAcceptedCorrection.corrected);
      if (index !== -1) {
        textareaRef.current.focus();
        textareaRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      setLastAcceptedCorrection(null);
    }
  }, [thesis, lastAcceptedCorrection]);

  // Keep the spotlight viewport perfectly aligned immediately when thesis or the card status updates
  useEffect(() => {
    if (liveActiveSpotlight) {
      const timer = setTimeout(() => {
        const highlightEl = document.getElementById('spotlight-match');
        if (highlightEl && textareaRef.current) {
          const offsetTop = highlightEl.offsetTop;
          const targetScroll = Math.max(0, offsetTop - 50);
          textareaRef.current.scrollTo({
            top: targetScroll,
            behavior: 'smooth'
          });
        }
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [thesis, liveActiveSpotlight?.status]);

  const [isSplitView, setIsSplitView] = useState(true);
  const [showScrollTop, setShowScrollTop] = useState(false);
  
  // Upload feedback states
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [showGuidance, setShowGuidance] = useState(false);
  const [guidanceTrigger, setGuidanceTrigger] = useState<'hover' | 'click' | null>(null);
  const [isIdleTextDone, setIsIdleTextDone] = useState(false);
  const [agent1IdleMessage, setAgent1IdleMessage] = useState("Hey Flam, ready when you are! What thesis are we roasting today? 🧐 Simply drag & drop your file into the white box, paste directly, or use the upload button, and I’ll get grinding.");
  const [isHoveringAuditEmpty, setIsHoveringAuditEmpty] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  
  // Spring for the lag effect on the 🚫 icon
  const springConfig = { damping: 25, stiffness: 200 };
  const mouseXSpring = useSpring(0, springConfig);
  const mouseYSpring = useSpring(0, springConfig);

  useEffect(() => {
    if (isHoveringAuditEmpty) {
      mouseXSpring.set(mousePos.x - 5); // 5px offset to the left
      mouseYSpring.set(mousePos.y);
    }
  }, [mousePos, isHoveringAuditEmpty, mouseXSpring, mouseYSpring]);
  
  const [hasLifted, setHasLifted] = useState(false);
  const isLifted = thesis.split('\n').length > 4 || thesis.length > 200;

  useEffect(() => {
    if (agent1State === 'running' || agent2State === 'running' || isCalculatingScore) {
      const timer = setTimeout(() => setShowCancel(true), 2200);
      return () => clearTimeout(timer);
    } else {
      setShowCancel(false);
    }
  }, [agent1State, agent2State, isCalculatingScore]);

  useEffect(() => {
    if (isLifted && !hasLifted) {
      setHasLifted(true);
    }
  }, [isLifted, hasLifted]);

  useEffect(() => {
    const wordCount = thesis.trim() ? thesis.trim().split(/\s+/).length : 0;
    if (wordCount > 300) {
      setAgent1IdleMessage("Impressive depth here! You've clearly put a lot of work into this. I’m ready to peel back the layers—just hit 'Audit' and I’ll begin the structural deep-dive.");
    } else if (thesis.trim()) {
      setAgent1IdleMessage("Hey Flam, ready when you are! What thesis are we roasting today? 🧐 Simply drag & drop your file into the white box, paste directly, or use the upload button, and I’ll get grinding.");
    }
  }, [thesis]);

  useEffect(() => {
    setIsIdleTextDone(false);
  }, [agent1IdleMessage]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const outputScrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleCorrectionClick = (correction: Correction) => {
    setActiveSpotlight(correction);

    // Give React a cycle to render the mapped spotlight span, then align it
    setTimeout(() => {
      const highlightEl = document.getElementById('spotlight-match');
      if (highlightEl && textareaRef.current) {
        // Calculate offset relative to the container. highlightEl.offsetTop is relative to the mirrored container
        const offsetTop = highlightEl.offsetTop;
        const targetScroll = Math.max(0, offsetTop - 50); // 50px offset from the top
        textareaRef.current.scrollTo({
          top: targetScroll,
          behavior: 'smooth'
        });
      }
    }, 10);
  };

  // Instant scroll on hover
  const handleHover = (correction: Correction) => {
    handleCorrectionClick(correction);
  };
  const handleHoverLeave = () => {
    // Keep spotlight active so user can read focused text after mouse leaves the card
  };

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const scrollThrottleRef = useRef<boolean>(false);
  const handleScroll = () => {
    if (scrollThrottleRef.current) return;
    scrollThrottleRef.current = true;
    requestAnimationFrame(() => {
      if (outputScrollRef.current) {
        const { scrollTop } = outputScrollRef.current;
        setShowScrollTop(scrollTop > 270);
      }
      scrollThrottleRef.current = false;
    });
  };

  const scrollToTop = () => {
    if (outputScrollRef.current) {
      outputScrollRef.current.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    }
  };

  const handleReset = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setThesis('');
    setAgent1State('idle');
    setAgent2State('idle');
    setAgent1Output('');
    setAgent2Output('');
    setAgent1Corrections([]);
    setAgent2Corrections([]);
    setAgent2Phase(1);
    setAgent2ScoreCalculated(false);
    setErrorMsg('');
    setWittyError(null);
    setActiveTab('agent1');
  };

  const handleCancelAudit = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setAgent1State('idle');
    setAgent2State('idle');
    setAgent1Output('');
    setAgent2Output('');
    setAgent1Corrections([]);
    setAgent2Corrections([]);
    setAgent2Phase(1);
    setAgent2ScoreCalculated(false);
    setErrorMsg('');
    setActiveTab('agent1');
  };

  const handleFileUpload = async (file: File) => {
    if (!file) return;

    setIsUploading(true);
    setUploadSuccess(false);

    const validExtensions = ['.txt', '.md', '.docx'];
    const fileName = file.name.toLowerCase();
    const isValid = validExtensions.some(ext => fileName.endsWith(ext));

    if (!isValid) {
      setIsUploading(false);
      const wittyMessages = [
        "Hold up, Professor! 🧐 We only accept .txt, .md, and .docx files. Your masterpiece is a bit too exotic for our current syllabus.",
        "Whoops! 🍎 We love creativity, but our agents only speak .txt, .md, and .docx. Please translate your brilliance and try again.",
        "Fascinating format, but... 📝 The Scribe and The Dean are strictly old-school. They requested .txt, .md, or .docx only."
      ];
      setWittyError(wittyMessages[Math.floor(Math.random() * wittyMessages.length)]);
      return;
    }

    try {
      // Artificial delay for smooth UX feedback
      await new Promise(resolve => setTimeout(resolve, 600));

      if (fileName.endsWith('.docx')) {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        setThesis(result.value);
      } else {
        const text = await file.text();
        setThesis(text);
      }
      
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 3000);
    } catch (err) {
      console.error('Error reading file:', err);
      setErrorMsg('Failed to read the file.');
    } finally {
      setIsUploading(false);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
    }
  };

  const handleAudit = async () => {
    if (!thesis.trim()) {
      setShowGuidance(true);
      setGuidanceTrigger('click');
      setAgent1IdleMessage("Heyy, hold on a sec, Flam... I can't exactly audit thin air, can I? 😄 Drop your thesis in the white box, hit 'Audit' and let's get this review moving.");
      return;
    }

    setShowGuidance(false);
    setGuidanceTrigger(null);
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setAgent1State('running');
    setAgent2State('idle');
    setAgent1Output('');
    setAgent2Output('');
    setAgent1Corrections([]);
    setAgent2Corrections([]);
    setAgent2Phase(1);
    setAgent2ScoreCalculated(false);
    setErrorMsg('');
    setActiveTab('agent1');

    try {
      const output1 = await runAgent1(thesis);
      if (signal.aborted) return;
      
      // Parse XML corrections
      const regex = /<correction>[\s\S]*?<location>([\s\S]*?)<\/location>[\s\S]*?<original>([\s\S]*?)<\/original>[\s\S]*?<corrected>([\s\S]*?)<\/corrected>[\s\S]*?<reasoning>([\s\S]*?)<\/reasoning>[\s\S]*?<\/correction>/gi;
      const extracted: Correction[] = [];
      let match;
      while ((match = regex.exec(output1)) !== null) {
        extracted.push({
          id: Math.random().toString(36).substr(2, 9),
          location: match[1].trim(),
          original: match[2].trim(),
          corrected: match[3].trim(),
          reasoning: match[4].trim(),
          status: 'pending'
        });
      }
      
      const cleanOutput = cleanAgentMarkdown(output1);
      
      setAgent1Corrections(extracted);
      setAgent1Output(cleanOutput || "No general structural issues found. See specific corrections below.");
      setAgent1State('completed');

      setAgent2State('running');
      // Do not switch tab automatically, let user stay on Scribe's tab
      const output2 = await runAgent2(thesis, output1, 1);
      if (signal.aborted) return;
      
      const extracted2: Correction[] = [];
      let match2;
      while ((match2 = regex.exec(output2)) !== null) {
        extracted2.push({
          id: Math.random().toString(36).substr(2, 9),
          location: match2[1].trim(),
          original: match2[2].trim(),
          corrected: match2[3].trim(),
          reasoning: match2[4].trim(),
          status: 'pending'
        });
      }
      const cleanOutput2 = cleanAgentMarkdown(output2);
      
      setAgent2Corrections(extracted2);
      setAgent2Output(cleanOutput2);
      setAgent2State('completed');
      setAgent2Phase(1);
    } catch (error: any) {
      if (signal.aborted) return;
      console.error('Audit failed:', error);
      
      let friendlyMsg = "Something went wrong during the audit. Please try again.";
      if (error.message?.includes('quota') || error.message?.includes('429')) {
        friendlyMsg = "We're experiencing high traffic right now. Please wait a moment and try again.";
      } else if (error.message?.includes('network') || !navigator.onLine) {
        friendlyMsg = "It looks like there's a connection issue. Please check your internet and try again.";
      } else if (error.message?.includes('safety') || error.message?.includes('blocked')) {
        friendlyMsg = "The content couldn't be processed due to safety filters. Please try a different excerpt.";
      }
      
      setErrorMsg(friendlyMsg);
      if (agent1State === 'running') setAgent1State('error');
      if (agent2State === 'running') setAgent2State('error');
    }
  };

  const handleAcceptAgent1 = (id: string) => {
    setAgent1Corrections(prev => prev.map(c => {
      if (c.id === id) {
        setThesis(current => {
          if (liveActiveSpotlight && liveActiveSpotlight.id === id && getMatchInfo) {
            const before = current.substring(0, getMatchInfo.index);
            const after = current.substring(getMatchInfo.index + getMatchInfo.length);
            return before + c.corrected + after;
          }
          try {
            const escaped = c.original
              .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
              .replace(/['`’‘]/g, "['`’‘]")
              .replace(/[“”"„]/g, '["“”„]')
              .replace(/\s+/g, '\\s+');
            const rx = new RegExp(escaped, 'i');
            if (rx.test(current)) {
              return current.replace(rx, c.corrected);
            }
          } catch (e) {}
          return current.replace(c.original, c.corrected);
        });
        setLastAcceptedCorrection(c);
        return { ...c, status: 'accepted' };
      }
      return c;
    }));
  };

  const handleRejectAgent1 = (id: string) => {
    setAgent1Corrections(prev => prev.map(c => c.id === id ? { ...c, status: 'rejected' } : c));
  };

  const handleUndoAgent1 = (id: string) => {
    setAgent1Corrections(prev => prev.map(c => {
      if (c.id === id) {
        if (c.status === 'accepted') {
          setThesis(current => {
            if (liveActiveSpotlight && liveActiveSpotlight.id === id && getMatchInfo) {
              const before = current.substring(0, getMatchInfo.index);
              const after = current.substring(getMatchInfo.index + getMatchInfo.length);
              return before + c.original + after;
            }
            try {
              const escaped = c.corrected
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/['`’‘]/g, "['`’‘]")
                .replace(/[“”"„]/g, '["“”„]')
                .replace(/\s+/g, '\\s+');
              const rx = new RegExp(escaped, 'i');
              if (rx.test(current)) {
                return current.replace(rx, c.original);
              }
            } catch (e) {}
            return current.replace(c.corrected, c.original);
          });
        }
        return { ...c, status: 'pending' };
      }
      return c;
    }));
  };

  const handleAcceptAgent2 = (id: string) => {
    setAgent2Corrections(prev => prev.map(c => {
      if (c.id === id) {
        setThesis(current => {
          if (liveActiveSpotlight && liveActiveSpotlight.id === id && getMatchInfo) {
            const before = current.substring(0, getMatchInfo.index);
            const after = current.substring(getMatchInfo.index + getMatchInfo.length);
            return before + c.corrected + after;
          }
          try {
            const escaped = c.original
              .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
              .replace(/['`’‘]/g, "['`’‘]")
              .replace(/[“”"„]/g, '["“”„]')
              .replace(/\s+/g, '\\s+');
            const rx = new RegExp(escaped, 'i');
            if (rx.test(current)) {
              return current.replace(rx, c.corrected);
            }
          } catch (e) {}
          return current.replace(c.original, c.corrected);
        });
        setLastAcceptedCorrection(c);
        return { ...c, status: 'accepted' };
      }
      return c;
    }));
  };

  const handleRejectAgent2 = (id: string) => {
    setAgent2Corrections(prev => prev.map(c => c.id === id ? { ...c, status: 'rejected' } : c));
  };

  const handleUndoAgent2 = (id: string) => {
    setAgent2Corrections(prev => prev.map(c => {
      if (c.id === id) {
        if (c.status === 'accepted') {
          setThesis(current => {
            if (liveActiveSpotlight && liveActiveSpotlight.id === id && getMatchInfo) {
              const before = current.substring(0, getMatchInfo.index);
              const after = current.substring(getMatchInfo.index + getMatchInfo.length);
              return before + c.original + after;
            }
            try {
              const escaped = c.corrected
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/['`’‘]/g, "['`’‘]")
                .replace(/[“”"„]/g, '["“”„]')
                .replace(/\s+/g, '\\s+');
              const rx = new RegExp(escaped, 'i');
              if (rx.test(current)) {
                return current.replace(rx, c.original);
              }
            } catch (e) {}
            return current.replace(c.corrected, c.original);
          });
        }
        return { ...c, status: 'pending' };
      }
      return c;
    }));
  };

  const handleReviewWithDean = async () => {
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setActiveTab('agent2');
    setAgent2State('running');
    setAgent2Phase(2);
    setAgent2Output('');
    setAgent2Corrections([]);
    setAgent2ScoreCalculated(false);
    
    try {
      const output2 = await runAgent2(thesis, agent1Output, 2);
      if (signal.aborted) return;
      
      const regex = /<correction>[\s\S]*?<location>([\s\S]*?)<\/location>[\s\S]*?<original>([\s\S]*?)<\/original>[\s\S]*?<corrected>([\s\S]*?)<\/corrected>[\s\S]*?<reasoning>([\s\S]*?)<\/reasoning>[\s\S]*?<\/correction>/gi;
      const extracted2: Correction[] = [];
      let match2;
      while ((match2 = regex.exec(output2)) !== null) {
        extracted2.push({
          id: Math.random().toString(36).substr(2, 9),
          location: match2[1].trim(),
          original: match2[2].trim(),
          corrected: match2[3].trim(),
          reasoning: match2[4].trim(),
          status: 'pending'
        });
      }
      const cleanOutput2 = cleanAgentMarkdown(output2);
      
      setAgent2Corrections(extracted2);
      setAgent2Output(cleanOutput2);
      
      // Automatically calculate score after review
      const scoreOutput = await calculateDefenseScore(thesis, cleanOutput2);
      if (signal.aborted) return;
      
      setAgent2Output(prev => prev + '\n\n---\n\n### Final Verdict\n\n' + scoreOutput);
      setAgent2ScoreCalculated(true);
      setAgent2State('completed');
    } catch (error: any) {
      if (signal.aborted) return;
      console.error('Dean review failed:', error);
      setErrorMsg(error.message || 'An error occurred during the Dean review.');
      setAgent2State('error');
    }
  };

  const handleCalculateScore = async () => {
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setIsCalculatingScore(true);
    try {
      let cleanBaseOutput = agent2Output;
      const verdictIndex = cleanBaseOutput.indexOf('\n\n---\n\n### Final Verdict');
      if (verdictIndex !== -1) {
        cleanBaseOutput = cleanBaseOutput.substring(0, verdictIndex);
      }
      const scoreOutput = await calculateDefenseScore(thesis, cleanBaseOutput);
      if (signal.aborted) return;
      
      setAgent2Output(cleanBaseOutput + '\n\n---\n\n### Final Verdict\n\n' + scoreOutput);
      setAgent2ScoreCalculated(true);
    } catch (error: any) {
      if (signal.aborted) return;
      console.error('Score calculation failed:', error);
      setErrorMsg(error.message || 'An error occurred during score calculation.');
    } finally {
      if (!signal.aborted) {
        setIsCalculatingScore(false);
      }
    }
  };

  const allAgent2CorrectionsResolved = agent2Corrections.length === 0 || agent2Corrections.every(c => c.status !== 'pending');

  const handleDownload = async () => {
    try {
      const doc = new Document({
        sections: [{
          properties: {},
          children: thesis.split('\n').map(line => new Paragraph({
            children: [new TextRun(line)]
          }))
        }]
      });
      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Audited_Manuscript.docx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to generate document", err);
      setErrorMsg("Failed to generate the Word document.");
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-8 flex items-center justify-center transition-colors duration-300">
      
      {/* Witty Error Modal */}
      <AnimatePresence>
        {wittyError && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-md"
            onClick={() => setWittyError(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-ios-bg-secondary p-8 rounded-[2rem] shadow-2xl max-w-md w-full border border-ios-separator text-center relative"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/30 text-orange-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <AlertTriangle size={32} />
              </div>
              <h3 className="text-xl font-semibold text-ios-label mb-3 tracking-tight">Format Not Recognized</h3>
              <p className="text-[15px] text-ios-label-secondary leading-relaxed mb-8">
                {wittyError}
              </p>
              <button
                onClick={() => setWittyError(null)}
                className="w-full bg-ios-label text-ios-bg font-medium py-3 rounded-xl transition-transform active:scale-95"
              >
                Got it, I'll convert it
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={`w-full ${isSplitView ? 'max-w-[1600px] h-[85vh]' : 'max-w-5xl min-h-[85vh] h-auto'} bg-ios-bg-secondary rounded-[2rem] apple-shadow overflow-hidden flex flex-col relative transition-all duration-500`}>
        
        {/* Header / Toolbar */}
        <header className="h-16 border-b border-ios-separator flex items-center justify-between px-6 apple-glass z-10 shrink-0 transition-colors duration-500">
          <div className="flex items-center gap-3">
            <div className="relative shrink-0 flex items-center justify-center">
              <img 
                src={avanteLogo} 
                alt="Avante Writings Logo" 
                className="w-[42px] h-[42px] object-cover rounded-full select-none shadow-[0_2px_8px_rgba(212,154,59,0.25)] border border-amber-500/20"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="flex flex-col">
              <h1 className="text-[17px] font-bold tracking-tight text-ios-label leading-none pt-[5px] pb-0 pl-[1px]">Avante Writings</h1>
              <span className="text-[10px] uppercase tracking-widest text-[#D49A3B] font-semibold mt-0 pt-[3px] pl-[1px]">Academic Audit Board</span>
            </div>
          </div>

          {/* Segmented Control for Output View */}
          <div className="hidden md:flex bg-ios-bg-tertiary p-1 ml-[4px] rounded-full relative transition-colors duration-500">
            <div 
              className="absolute inset-y-1 left-1 bg-ios-bg-secondary rounded-full shadow-sm transition-all duration-500 ease-[cubic-bezier(0.25,1,0.5,1)]"
              style={{ 
                width: 'calc(50% - 4px)', 
                transform: activeTab === 'agent1' ? 'translateX(0)' : 'translateX(100%)' 
              }}
            />
            <button
              onClick={() => setActiveTab('agent1')}
              className={`relative z-10 px-6 py-1.5 text-sm font-medium transition-colors rounded-full ${
                activeTab === 'agent1' ? 'text-ios-label' : 'text-ios-label-secondary hover:text-ios-label'
              }`}
            >
              The Scribe
            </button>
            <button
              onClick={() => setActiveTab('agent2')}
              className={`relative z-10 px-6 py-1.5 text-sm font-medium transition-colors rounded-full ${
                activeTab === 'agent2' ? 'text-ios-label' : 'text-ios-label-secondary hover:text-ios-label'
              }`}
            >
              The Dean
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsSplitView(!isSplitView)}
              className={`flex items-center justify-center px-3 py-1.5 transition-all duration-300 rounded-full group ${
                isDarkMode ? 'hover:bg-ios-bg-tertiary' : 'hover:bg-slate-200'
              }`}
              title={isSplitView ? "Minimize View" : "Maximize View"}
            >
              {isSplitView ? (
                <Minimize size={18} className="text-slate-300 transition-colors duration-300 group-hover:text-ios-label shrink-0" />
              ) : (
                <Maximize size={18} className="text-slate-300 transition-colors duration-300 group-hover:text-ios-label shrink-0" />
              )}
              <span className="overflow-hidden whitespace-nowrap text-[14px] font-medium text-ios-label transition-all duration-300 max-w-0 opacity-0 group-hover:max-w-[80px] group-hover:opacity-100 group-hover:ml-2">
                {isSplitView ? "Minimize" : "Maximize"}
              </span>
            </button>

            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`flex items-center justify-center px-3 py-1.5 transition-all duration-300 rounded-full group ${
                isDarkMode ? 'hover:bg-ios-bg-tertiary' : 'hover:bg-slate-200'
              }`}
              title="Toggle Theme"
            >
              <AnimatePresence mode="wait" initial={false}>
                {isDarkMode ? (
                  <motion.div
                    key="sun"
                    initial={{ rotate: -360, opacity: 0, scale: 0.5 }}
                    animate={{ rotate: 0, opacity: 1, scale: 1 }}
                    exit={{ rotate: 360, opacity: 0, scale: 0.5 }}
                    whileHover={{ 
                      rotate: 180,
                      scale: 1.1,
                      filter: "drop-shadow(0 0 12px rgba(240, 192, 90, 0.5))"
                    }}
                    whileTap={{ scale: 0.9, rotate: 180 }}
                    transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                    className="shrink-0"
                  >
                    <Sun size={18} className="text-amber-400 saturate-[0.6] transition-all duration-300 group-hover:text-amber-300" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="moon"
                    initial={{ rotate: 360, opacity: 0, scale: 0.5 }}
                    animate={{ rotate: 0, opacity: 1, scale: 1 }}
                    exit={{ rotate: -360, opacity: 0, scale: 0.5 }}
                    whileHover={{ 
                      rotate: -15, 
                      scale: 1.1,
                      filter: "drop-shadow(0 0 12px rgba(255, 255, 255, 0.6))"
                    }}
                    whileTap={{ scale: 0.9, rotate: -15 }}
                    transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                    className="flex items-center justify-center shrink-0"
                  >
                    <svg 
                      width="19" 
                      height="19" 
                      viewBox="0 0 24 24" 
                      fill="currentColor" 
                      className="text-slate-300 transition-colors duration-300 group-hover:text-white"
                    >
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                  </motion.div>
                )}
              </AnimatePresence>
              <span className="overflow-hidden whitespace-nowrap text-[14px] font-medium text-ios-label transition-all duration-300 max-w-0 opacity-0 group-hover:max-w-[60px] group-hover:opacity-100 group-hover:ml-2">
                {isDarkMode ? "Go Bright" : "Go Dark"}
              </span>
            </button>
            
            <div className="w-px h-4 bg-ios-separator mx-2"></div>

            <button
              onClick={handleReset}
              className="flex items-center gap-2 text-ios-label-secondary hover:text-ios-label px-3 py-1.5 rounded-full text-[15px] font-medium transition-colors"
              title="Reset Audit"
            >
              <RotateCcw size={18} />
              <span className="hidden md:inline">Reset</span>
            </button>

            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={onFileInputChange} 
              accept=".txt,.md,.docx" 
              className="hidden" 
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[15px] font-medium transition-all duration-300 ${
                uploadSuccess 
                  ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20' 
                  : 'text-ios-accent hover:bg-ios-accent/10'
              }`}
            >
              {isUploading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span className="hidden md:inline">Uploading...</span>
                </>
              ) : uploadSuccess ? (
                <>
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring' }}>
                    <CheckCircle size={18} />
                  </motion.div>
                  <span className="hidden md:inline">Success</span>
                </>
              ) : (
                <>
                  <UploadCloud size={18} />
                  <span className="hidden md:inline">Upload</span>
                </>
              )}
            </button>
            <div className="relative w-[124px] h-[36px] ml-1 flex items-center">
              <AnimatePresence mode="popLayout">
                {agent2ScoreCalculated ? (
                  <motion.button
                    key="download"
                    initial={{ opacity: 0, scale: 0.9, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, scale: 0.9, filter: 'blur(4px)' }}
                    whileHover="hover"
                    whileTap="tap"
                    variants={{
                      hover: { 
                        scale: 1.02,
                        rotate: [0, -2, 2, -1, 1, 0],
                        transition: {
                          rotate: {
                            duration: 0.45,
                            ease: "easeInOut"
                          },
                          scale: { duration: 0.2 }
                        }
                      },
                      tap: { scale: 0.96, y: 1 }
                    }}
                    transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                    onClick={handleDownload}
                    className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full text-[15px] font-medium transition-colors shadow-sm h-full w-full group"
                  >
                    <GoogleDownloadIcon size={16} />
                    Download
                  </motion.button>
                ) : (agent1State === 'running' || agent2State === 'running' || isCalculatingScore) ? (
                  <motion.div
                    key="auditing"
                    initial={{ opacity: 0, scale: 0.9, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, scale: 0.9, filter: 'blur(4px)' }}
                    transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                    className="flex items-center justify-between auditing-glass-button rounded-full text-[14px] font-medium h-full px-3 w-full overflow-hidden"
                  >
                    <div className="flex items-center gap-2 overflow-hidden flex-1">
                      <Loader2 size={14} className="animate-spin text-ios-accent shrink-0" />
                      <div className="flex text-ios-label whitespace-nowrap relative items-center">
                        {"Auditing".split("").map((char, i) => (
                          <motion.span
                            key={i}
                            initial={{ 
                              x: i === 0 ? -20 : 80, 
                              opacity: 0,
                              filter: 'blur(4px)'
                            }}
                            animate={{ 
                              x: 0, 
                              opacity: showCancel ? (i < 2 ? 1 : 0) : 1,
                              display: showCancel ? (i < 2 ? 'inline-block' : 'none') : 'inline-block',
                              filter: 'blur(0px)'
                            }}
                            transition={{
                              x: {
                                delay: i === 0 ? 0 : 0.2 + i * 0.1,
                                duration: i === 0 ? 1.4 : 1.0,
                                ease: [0.22, 1, 0.36, 1]
                              },
                              opacity: {
                                duration: showCancel ? 0.4 : 1.0,
                                delay: showCancel ? 0 : (i === 0 ? 0 : 0.2 + i * 0.1)
                              }
                            }}
                            style={{ 
                              zIndex: i === 0 ? 10 : 1,
                              position: 'relative'
                            }}
                            className="inline-block"
                          >
                            {char}
                          </motion.span>
                        ))}
                        
                        <AnimatePresence>
                          {showCancel && (
                            <motion.span
                              initial={{ opacity: 0, x: 10, filter: 'blur(2px)' }}
                              animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                              exit={{ opacity: 0, x: 10 }}
                              transition={{ duration: 0.6, delay: 0.2 }}
                              className="inline-block text-ios-label"
                            >
                              ...
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                    
                    <AnimatePresence>
                      {showCancel && (
                        <motion.div 
                          initial={{ opacity: 0, x: 40, filter: 'blur(8px)' }}
                          animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                          exit={{ opacity: 0, x: 40, filter: 'blur(8px)' }}
                          transition={{ 
                            duration: 0.9, 
                            ease: [0.34, 1.56, 0.64, 1],
                            delay: 0.1
                          }}
                          className="flex items-center gap-1.5 shrink-0 ml-1"
                        >
                          <span className="text-ios-label-tertiary font-light">|</span>
                          <button 
                            onClick={handleCancelAudit}
                            className="p-1 bg-red-50 dark:bg-red-900/20 rounded-full transition-all duration-200 group active:scale-90"
                            title="Cancel Audit"
                          >
                            <X size={14} className="text-red-500 group-hover:text-red-600 transition-colors" />
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ) : (
                  <motion.button
                    key="audit"
                    initial={{ opacity: 0, scale: 0.9, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, scale: 0.9, filter: 'blur(4px)' }}
                    whileTap={thesis.trim() ? { scale: 0.96, y: 1 } : {}}
                    transition={{ duration: 0.2 }}
                    onClick={handleAudit}
                    onMouseEnter={() => {
                      if (!thesis.trim()) {
                        setIsHoveringAuditEmpty(true);
                        setShowGuidance(true);
                        setGuidanceTrigger('hover');
                        setAgent1IdleMessage("Heyy, hold on a sec, Flam... I can't exactly audit thin air, can I? 😄 Drop your thesis in the white box, hit 'Audit' and let's get this review moving.");
                      }
                    }}
                    onMouseMove={(e) => {
                      if (!thesis.trim()) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setMousePos({
                          x: e.clientX - rect.left,
                          y: e.clientY - rect.top
                        });
                      }
                    }}
                    onMouseLeave={() => {
                      setIsHoveringAuditEmpty(false);
                      if (guidanceTrigger === 'hover') {
                        setShowGuidance(false);
                        setGuidanceTrigger(null);
                        setAgent1IdleMessage("Ready when you are. Give me your thesis and I'll hit the ground running.");
                      }
                    }}
                    className="flex items-center justify-center gap-2 glass-button rounded-full text-[15px] font-medium h-full w-full relative group"
                  >
                    <Send size={16} className="text-[#0071e3]" />
                    <span className="text-ios-label">Audit</span>
                    
                    <AnimatePresence>
                      {isHoveringAuditEmpty && (
                        <motion.div
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0, opacity: 0, filter: 'blur(8px)' }}
                          transition={{ duration: 0.8, ease: [0.23, 1, 0.32, 1] }}
                          style={{
                            position: 'absolute',
                            left: mouseXSpring,
                            top: mouseYSpring,
                            pointerEvents: 'none',
                            transform: 'translate(-50%, -50%)',
                            zIndex: 50
                          }}
                          className="text-[15px]"
                        >
                          🚫
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        {/* Main Content Split */}
        <main className={`flex-1 flex ${isSplitView ? 'flex-col lg:flex-row' : 'flex-col'} bg-ios-bg-secondary transition-colors duration-500 overflow-hidden`}>
          
          {/* Left Column: Input */}
          <div 
            className={`w-full ${isSplitView ? 'lg:w-1/2 border-r h-auto' : 'max-w-5xl mx-auto flex-1 min-h-0'} flex flex-col border-ios-separator relative group transition-colors duration-500 shrink-0`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            {/* Cabriolet Expansion (The Moving Part) */}
            <div className={`relative z-0 overflow-hidden shrink-0 w-full ${isSplitView ? 'max-w-4xl' : 'max-w-5xl'} mx-auto`}>
              <div 
                className={`
                  grid transition-all cabriolet-easing
                  ${(thesis.length > 0 || showGuidance) ? 'grid-rows-[1fr] duration-700' : 'grid-rows-[0fr] duration-[1800ms]'}
                `}
              >
                <div className="overflow-hidden">
                  <div 
                    className={`
                      transition-all cabriolet-easing transform
                      ${(thesis.length > 0 || showGuidance) ? 'translate-y-0 duration-700' : '-translate-y-full duration-[1800ms]'}
                      bg-ios-bg-tertiary
                      px-6 py-3 flex items-center justify-between relative
                      ${(thesis.length > 0 || showGuidance) ? 'rounded-none' : 'rounded-b-2xl'}
                    `}
                  >
                    <div className="flex items-center gap-4">
                      {showGuidance && !thesis.trim() ? (
                        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-orange-500 animate-pulse">
                          <AlertTriangle size={14} />
                          <span>Please provide text below to start the audit</span>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-ios-label-secondary">
                            <FileText size={14} className="text-ios-accent" />
                            <span>Intelligence Active</span>
                          </div>
                          <div className="h-3 w-px bg-ios-separator" />
                          <div className="flex items-center gap-3 text-[12px] font-medium text-ios-label">
                            <span className="flex items-center gap-1">
                              <span className="text-ios-label-secondary">Words:</span> 
                              {thesis.trim() ? thesis.trim().split(/\s+/).length : 0}
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="text-ios-label-secondary">Chars:</span> 
                              {thesis.length}
                            </span>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-tight">
                        Live Sync
                      </div>
                    </div>

                    {/* Leading Edge Shimmer/Highlight */}
                    <AnimatePresence>
                      {(thesis.length > 0 || showGuidance) && (
                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: [0, 1, 0] }}
                          transition={{ duration: 1.5, times: [0, 0.5, 1] }}
                          className={`absolute bottom-0 left-0 right-0 h-[1px] ${showGuidance && !thesis.trim() ? 'bg-orange-500 shadow-[0_0_8px_#f97316]' : 'bg-[#0071e3] shadow-[0_0_8px_#0071e3]'}`}
                        />
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            </div>

            {/* Drag Overlay */}
            <AnimatePresence>
              {isDragging && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 apple-glass-dark z-20 flex items-center justify-center pointer-events-none"
                >
                  <div className="bg-ios-bg-secondary/90 backdrop-blur-xl p-8 rounded-[2rem] shadow-2xl flex flex-col items-center gap-4 border border-ios-separator">
                    <div className="bg-ios-accent/10 p-4 rounded-full">
                      <UploadCloud size={48} className="text-ios-accent" />
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-semibold text-ios-label tracking-tight">Drop Manuscript</p>
                      <p className="text-[15px] text-ios-label-secondary mt-1">Supports .txt, .md, .docx</p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            
            <div ref={editorContainerRef} className={`flex-1 p-[1.5px] lg:p-[2.5px] flex flex-col relative z-10 w-full ${isSplitView ? 'max-w-4xl' : 'max-w-5xl'} mx-auto overflow-y-auto`}>
              <div className="relative min-h-[100px] w-full flex-1 isolate">
                {/* Dark Masking Overlay for Intelligent Scroll */}
                <div 
                  className={`absolute -inset-4 bg-slate-950/[0.015] dark:bg-black/[0.06] border border-black/[0.02] dark:border-white/[0.04] shadow-[0_8px_32px_rgba(0,0,0,0.03)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.25)] rounded-2xl pointer-events-none transition-all duration-500 ease-out z-0 ${liveActiveSpotlight && getMatchInfo ? 'opacity-100 scale-100' : 'opacity-0 scale-[0.98]'}`}
                  style={{
                    backdropFilter: 'blur(16px) saturate(120%)',
                    WebkitBackdropFilter: 'blur(16px) saturate(120%)'
                  }}
                />
                
                <div 
                  ref={mirroredRef}
                  className={`absolute inset-0 pl-[4px] pr-0 pb-0 whitespace-pre-wrap break-words text-[17px] leading-relaxed font-sans pointer-events-none transition-opacity duration-300 overflow-y-scroll [scrollbar-width:none] [&::-webkit-scrollbar]:hidden z-10 ${liveActiveSpotlight && getMatchInfo ? 'opacity-100' : 'opacity-0'}`}
                  aria-hidden="true"
                >
                  {renderMirroredText()}
                </div>
                <textarea
                  ref={textareaRef}
                  value={thesis}
                  onScroll={handleEditorScroll}
                  onChange={handleTextareaChange}
                  onClick={() => setActiveSpotlight(null)}
                  onBlur={() => setActiveSpotlight(null)}
                  placeholder="Start typing, paste your thesis excerpt here, or drop a file..."
                  className={`w-full h-full min-h-[100px] pl-[4px] pr-0 pb-0 resize-none outline-none ${liveActiveSpotlight && getMatchInfo ? 'text-transparent' : 'text-ios-label'} caret-blue-500 text-[17px] leading-relaxed font-sans placeholder:text-ios-label-tertiary bg-transparent relative z-10 ${showGuidance && !thesis ? 'animate-placeholder-blink' : ''}`}
                  spellCheck={false}
                />
              </div>
            </div>
          </div>

          {/* Right Column: Output */}
          <motion.div 
            initial={isSplitView ? false : { marginTop: 110 }}
            animate={
              isSplitView
                ? {
                    marginTop: 0,
                    x: 0,
                    scale: 1,
                    boxShadow: '0px 0px 0px rgba(0,0,0,0)'
                  }
                : isLifted
                  ? { 
                      marginTop: [30, 85, 80],
                      x: [null, -2, 0],
                      scale: [null, 1.008, 1],
                      boxShadow: [
                        '0px 0px 0px rgba(0,0,0,0)', 
                        '0px -4px 12px rgba(0,0,0,0.04)', 
                        '0px 0px 0px rgba(0,0,0,0)'
                      ]
                    } 
                  : hasLifted
                    ? { 
                        marginTop: [80, 22, 30],
                        x: [null, -2, 0],
                        scale: [null, 1.008, 1],
                        boxShadow: [
                          '0px 0px 0px rgba(0,0,0,0)', 
                          '0px -4px 12px rgba(0,0,0,0.04)', 
                          '0px 0px 0px rgba(0,0,0,0)'
                        ]
                      }
                    : { 
                        marginTop: 30,
                        x: 0,
                        scale: 1,
                        boxShadow: '0px 0px 0px rgba(0,0,0,0)'
                      }
            }
            transition={{ duration: 2.2, ease: [0.45, 0, 0.55, 1], times: [0, 0.4, 1] }}
            className={`w-full ${isSplitView ? 'lg:w-1/2 rounded-tl-[2rem] flex-1' : 'max-w-5xl mx-auto rounded-t-[2rem] min-h-[700px] shrink-0'} flex flex-col bg-ios-bg-tertiary relative transition-all duration-500 min-h-0 z-20`}
          >
            
            {/* Error Message */}
            <AnimatePresence>
              {errorMsg && (
                <motion.div 
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className={`absolute top-4 left-4 right-4 lg:left-0 lg:right-0 ${isSplitView ? 'max-w-4xl' : 'max-w-5xl'} mx-auto z-50 p-4 bg-ios-bg-secondary/90 border border-ios-separator rounded-2xl flex items-center justify-between gap-3 text-red-600 shadow-lg backdrop-blur-md`}
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle size={20} className="shrink-0 mt-0.5" />
                    <p className="text-[15px] font-medium leading-tight">{errorMsg}</p>
                  </div>
                  <button 
                    onClick={() => {
                      setErrorMsg('');
                      handleAudit();
                    }}
                    className="shrink-0 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-[13px] font-semibold rounded-xl transition-colors flex items-center gap-2"
                  >
                    <RefreshCw size={14} />
                    Retry
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Output Content */}
            <div 
              ref={outputScrollRef}
              onScroll={handleScroll}
              className="flex-1 p-8 lg:p-12 overflow-y-auto"
            >
              <AnimatePresence mode="wait">
                {activeTab === 'agent1' && (
                  <motion.div
                    key="agent1"
                    initial={{ '--burn-intercept': -5, opacity: 0, y: 15 } as any}
                    animate={{ '--burn-intercept': 5, opacity: 1, y: 0 } as any}
                    exit={{ '--burn-intercept': -5, opacity: 0, y: -15 } as any}
                    transition={{ duration: 1.4, ease: [0.45, 0, 0.55, 1] }}
                    style={{ filter: 'url(#ink-burn)' }}
                    className={`${isSplitView ? 'max-w-4xl' : 'max-w-5xl'} mx-auto`}
                  >
                    <div className="mb-10 flex items-center justify-between pb-6 border-b border-ios-separator">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-full bg-ios-bg-tertiary flex items-center justify-center shrink-0 shadow-sm border border-ios-separator">
                          <UserCog size={26} className="text-ios-label" />
                        </div>
                        <div>
                          <h3 className="text-xl font-semibold tracking-tight text-ios-label">Dr. Silas Vance</h3>
                          <p className="text-[13px] text-ios-label-secondary uppercase tracking-widest font-medium mt-0.5">Lead Structural Auditor</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-center h-7 px-3 rounded-full bg-ios-bg-secondary border border-ios-separator">
                        <AnimatePresence mode="wait">
                          {agent1State === 'idle' ? (
                            <motion.div
                              key="standby"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.3 }}
                              className="flex items-center gap-2"
                            >
                              <div className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)] animate-pulse" />
                              <span className="text-[10px] font-bold uppercase tracking-widest text-ios-label-secondary leading-none pt-[1px]">
                                Standby
                              </span>
                            </motion.div>
                          ) : (
                            <motion.div
                              key="active"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.3 }}
                              className="flex items-center gap-2"
                            >
                              <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 leading-none pt-[1px]">
                                Active
                              </span>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                    
                    <AnimatePresence mode="wait">
                      {agent1State === 'idle' && (
                        <motion.div 
                          key="idle"
                          exit={{ opacity: 0, transition: { duration: 1.5, ease: "easeOut" } }}
                          className="markdown-body"
                        >
                          <motion.p 
                            key={agent1IdleMessage}
                            initial="hidden"
                            animate="visible"
                            onAnimationComplete={() => setIsIdleTextDone(true)}
                            variants={{
                              visible: { transition: { staggerChildren: 0.08 } }
                            }}
                          >
                            {agent1IdleMessage.split(" ").map((word, i) => (
                              <React.Fragment key={i}>
                                <motion.span
                                  variants={{
                                    hidden: { opacity: 0, filter: 'blur(8px)', y: 6 },
                                    visible: { opacity: 1, filter: 'blur(0px)', y: 0, transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] } }
                                  }}
                                  animate={isIdleTextDone && (word.includes('🧐') || word.includes('😄')) ? { 
                                    scale: [1, 1.1, 1],
                                    filter: ['blur(0px)', 'blur(0px)', 'blur(0px)'], // Keep it sharp
                                    opacity: 1,
                                    y: 0
                                  } : undefined}
                                  transition={isIdleTextDone && (word.includes('🧐') || word.includes('😄')) ? { 
                                    scale: {
                                      duration: 2,
                                      repeat: Infinity,
                                      ease: "easeInOut"
                                    }
                                  } : undefined}
                                  className="inline-block"
                                >
                                  {word}
                                </motion.span>
                                {" "}
                              </React.Fragment>
                            ))}
                          </motion.p>
                        </motion.div>
                      )}
                      
                      {agent1State === 'running' && !agent1Output && (
                        <motion.div 
                          key="running"
                          initial={{ opacity: 0, filter: 'blur(10px)' }}
                          animate={{ opacity: 1, filter: 'blur(0px)' }}
                          exit={{ opacity: 0, filter: 'blur(10px)' }}
                          transition={{ duration: 0.5 }}
                          className="flex flex-col items-center justify-center py-32 gap-6 text-ios-label-secondary"
                        >
                          <Loader2 size={32} className="animate-spin text-ios-accent" />
                          <p className="text-[17px] font-medium">Performing surgical audit...</p>
                        </motion.div>
                      )}
  
                      {agent1Output && (
                        <motion.div 
                          key="output"
                          initial={{ opacity: 0, filter: 'blur(10px)' }}
                          animate={{ opacity: 1, filter: 'blur(0px)' }}
                          transition={{ duration: 0.5 }}
                          className="markdown-body"
                        >
                          <Markdown>{agent1Output}</Markdown>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Interactive Correction Cards */}
                    {agent1Corrections.length > 0 && (
                      <div className="mt-12 space-y-6">
                        <h4 className="text-lg font-semibold text-ios-label mb-6 border-b border-ios-separator pb-2">Suggested Corrections</h4>
                        {agent1Corrections.map(c => (
                          <motion.div 
                            key={c.id} 
                            layout
                            onClick={() => handleCorrectionClick(c)}
                            onMouseEnter={() => handleHover(c)}
                            onMouseLeave={handleHoverLeave}
                            className="bg-ios-bg-secondary p-6 rounded-2xl border border-ios-separator shadow-sm cursor-pointer hover:border-ios-accent transition-colors"
                          >
                            <div className="flex justify-between items-start mb-4">
                              <span className="text-xs font-semibold uppercase tracking-wider text-ios-label-secondary">{c.location}</span>
                              {c.status === 'pending' ? (
                                <div className="flex gap-2">
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); handleCorrectionClick(c); handleRejectAgent1(c.id); }} 
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400 rounded-full transition-colors"
                                  >
                                    <X size={14} /> Reject
                                  </button>
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); handleCorrectionClick(c); handleAcceptAgent1(c.id); }} 
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400 rounded-full transition-colors"
                                  >
                                    <Check size={14} /> Accept
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-3">
                                  <span className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-wider ${c.status === 'accepted' ? 'text-emerald-500' : 'text-red-500'}`}>
                                    {c.status === 'accepted' ? <Check size={14} /> : <X size={14} />} {c.status}
                                  </span>
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); handleCorrectionClick(c); handleUndoAgent1(c.id); }} 
                                    title="Undo action"
                                    className="w-7 h-7 flex items-center justify-center rounded-full bg-ios-bg-tertiary border border-ios-separator text-ios-label-secondary hover:text-ios-accent hover:border-ios-accent active:scale-95 transition-all duration-300"
                                  >
                                    <RotateCcw size={11} />
                                  </button>
                                </div>
                              )}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                              <div className="bg-red-50/50 dark:bg-red-900/10 p-4 rounded-xl border border-red-100 dark:border-red-900/30">
                                <span className="block text-[11px] font-bold text-red-500 uppercase mb-2">Original</span>
                                <p className="text-[15px] text-ios-label line-through decoration-red-300 dark:decoration-red-800/50">{c.original}</p>
                              </div>
                              <div className="bg-emerald-50/50 dark:bg-emerald-900/10 p-4 rounded-xl border border-emerald-100 dark:border-emerald-900/30">
                                <span className="block text-[11px] font-bold text-emerald-500 uppercase mb-2">Corrected</span>
                                <p className="text-[15px] text-ios-label">{c.corrected}</p>
                              </div>
                            </div>
                            <div className="text-[14px] text-ios-label-secondary bg-ios-bg-tertiary p-4 rounded-xl">
                              <strong className="font-medium text-ios-label">Reasoning:</strong> {c.reasoning}
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}

                {activeTab === 'agent2' && (
                  <motion.div
                    key="agent2"
                    initial={{ '--burn-intercept': -5, opacity: 0, y: 15 } as any}
                    animate={{ '--burn-intercept': 5, opacity: 1, y: 0 } as any}
                    exit={{ '--burn-intercept': -5, opacity: 0, y: -15 } as any}
                    transition={{ duration: 1.4, ease: [0.45, 0, 0.55, 1] }}
                    style={{ filter: 'url(#ink-burn)' }}
                    className={`${isSplitView ? 'max-w-4xl' : 'max-w-5xl'} mx-auto`}
                  >
                    <div className="mb-10 flex items-center justify-between pb-6 border-b border-ios-separator">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-full bg-ios-bg-tertiary flex items-center justify-center shrink-0 shadow-sm border border-ios-separator">
                          <BookOpen size={26} className="text-white" />
                        </div>
                        <div>
                          <h3 className="text-xl font-semibold tracking-tight text-ios-label">Dean Eleanor Sterling</h3>
                          <p className="text-[13px] text-ios-label-secondary uppercase tracking-widest font-medium mt-0.5">Executive Academic Critic</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-center h-7 px-3 rounded-full bg-ios-bg-secondary border border-ios-separator">
                        <AnimatePresence mode="wait">
                          {agent2State === 'idle' ? (
                            <motion.div
                              key="standby"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.3 }}
                              className="flex items-center gap-2"
                            >
                              <div className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)] animate-pulse" />
                              <span className="text-[10px] font-bold uppercase tracking-widest text-ios-label-secondary leading-none pt-[1px]">
                                Standby
                              </span>
                            </motion.div>
                          ) : (
                            <motion.div
                              key="active"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.3 }}
                              className="flex items-center gap-2"
                            >
                              <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 leading-none pt-[1px]">
                                Active
                              </span>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>

                    <AnimatePresence mode="wait">
                      {agent2State === 'idle' && (
                        <motion.div 
                          key="idle"
                          exit={{ opacity: 0, transition: { duration: 1.5, ease: "easeOut" } }}
                          className="markdown-body"
                        >
                          <motion.p 
                            initial="hidden"
                            animate="visible"
                            variants={{
                              visible: { transition: { staggerChildren: 0.08 } }
                            }}
                          >
                            {"Waiting for the Scribe agent's audit...".split(" ").map((word, i) => (
                              <React.Fragment key={i}>
                                <motion.span
                                  variants={{
                                    hidden: { opacity: 0, filter: 'blur(8px)', y: 6 },
                                    visible: { opacity: 1, filter: 'blur(0px)', y: 0, transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] } }
                                  }}
                                  className="inline-block"
                                >
                                  {word}
                                </motion.span>
                                {" "}
                              </React.Fragment>
                            ))}
                          </motion.p>
                        </motion.div>
                      )}
  
                      {agent2State === 'running' && !agent2Output && (
                        <motion.div 
                          key="running"
                          initial={{ opacity: 0, filter: 'blur(10px)' }}
                          animate={{ opacity: 1, filter: 'blur(0px)' }}
                          exit={{ opacity: 0, filter: 'blur(10px)' }}
                          transition={{ duration: 0.5 }}
                          className="flex flex-col items-center justify-center py-32 gap-6 text-ios-label-secondary"
                        >
                          <Loader2 size={32} className="animate-spin text-ios-accent" />
                          <p className="text-[17px] font-medium">Reviewing the audit...</p>
                        </motion.div>
                      )}
  
                      {agent2Output && (
                        <motion.div 
                          key="output"
                          initial={{ opacity: 0, filter: 'blur(10px)' }}
                          animate={{ opacity: 1, filter: 'blur(0px)' }}
                          transition={{ duration: 0.5 }}
                          className="markdown-body"
                        >
                          <Markdown>{agent2Output}</Markdown>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Interactive Correction Cards for Dean */}
                    {agent2Corrections.length > 0 && (
                      <div className="mt-12 space-y-6">
                        <h4 className="text-lg font-semibold text-ios-label mb-6 border-b border-ios-separator pb-2">Dean's Pointers</h4>
                        {agent2Corrections.map(c => (
                          <motion.div 
                            key={c.id} 
                            layout
                            onClick={() => handleCorrectionClick(c)}
                            onMouseEnter={() => handleHover(c)}
                            onMouseLeave={handleHoverLeave}
                            className="bg-ios-bg-secondary p-6 rounded-2xl border border-ios-separator shadow-sm cursor-pointer hover:border-ios-accent transition-colors"
                          >
                            <div className="flex justify-between items-start mb-4">
                              <span className="text-xs font-semibold uppercase tracking-wider text-ios-label-secondary">{c.location}</span>
                              {c.status === 'pending' ? (
                                <div className="flex gap-2">
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); handleCorrectionClick(c); handleRejectAgent2(c.id); }} 
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400 rounded-full transition-colors"
                                  >
                                    <X size={14} /> Reject
                                  </button>
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); handleCorrectionClick(c); handleAcceptAgent2(c.id); }} 
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400 rounded-full transition-colors"
                                  >
                                    <Check size={14} /> Accept
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-3">
                                  <span className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-wider ${c.status === 'accepted' ? 'text-emerald-500' : 'text-red-500'}`}>
                                    {c.status === 'accepted' ? <Check size={14} /> : <X size={14} />} {c.status}
                                  </span>
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); handleCorrectionClick(c); handleUndoAgent2(c.id); }} 
                                    title="Undo action"
                                    className="w-7 h-7 flex items-center justify-center rounded-full bg-ios-bg-tertiary border border-ios-separator text-ios-label-secondary hover:text-ios-accent hover:border-ios-accent active:scale-95 transition-all duration-300"
                                  >
                                    <RotateCcw size={11} />
                                  </button>
                                </div>
                              )}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                              <div className="bg-red-50/50 dark:bg-red-900/10 p-4 rounded-xl border border-red-100 dark:border-red-900/30">
                                <span className="block text-[11px] font-bold text-red-500 uppercase mb-2">Original</span>
                                <p className="text-[15px] text-ios-label line-through decoration-red-300 dark:decoration-red-800/50">{c.original}</p>
                              </div>
                              <div className="bg-emerald-50/50 dark:bg-emerald-900/10 p-4 rounded-xl border border-emerald-100 dark:border-emerald-900/30">
                                <span className="block text-[11px] font-bold text-emerald-500 uppercase mb-2">Corrected</span>
                                <p className="text-[15px] text-ios-label">{c.corrected}</p>
                              </div>
                            </div>
                            <div className="text-[14px] text-ios-label-secondary bg-ios-bg-tertiary p-4 rounded-xl">
                              <strong className="font-medium text-ios-label">Reasoning:</strong> {c.reasoning}
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            
            {/* Scroll to Top Button */}
            <AnimatePresence>
              {showScrollTop && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={scrollToTop}
                  aria-label="Scroll to top"
                  className={`z-50 w-12 h-12 rounded-full bg-ios-bg-secondary/80 backdrop-blur-md border border-ios-separator flex items-center justify-center shadow-lg transition-colors duration-500 ${
                    isSplitView 
                      ? 'fixed bottom-8 right-8' 
                      : 'fixed bottom-24 right-8 xl:absolute xl:-right-20 xl:bottom-2'
                  }`}
                >
                  <ArrowUp size={20} className="text-ios-label" />
                </motion.button>
              )}
            </AnimatePresence>

            {/* Floating Action Button */}
            <AnimatePresence mode="wait">
              {agent1State === 'completed' && activeTab === 'agent1' && (
                <motion.button
                  key="review-dean"
                  initial={{ opacity: 0, scale: 0.8, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8, y: 20 }}
                  onClick={handleReviewWithDean}
                  className="absolute bottom-8 right-8 z-30 flex items-center gap-2 text-white px-5 py-3 rounded-full font-medium transition-transform active:scale-95 animate-alive-jiggle apple-3d-glass-blue"
                >
                  <UserCog size={18} />
                  Review with Dean
                </motion.button>
              )}
              {agent2State === 'completed' && activeTab === 'agent2' && !agent2ScoreCalculated && (
                <motion.button
                  key="calc-score"
                  initial={{ rotateX: 90, opacity: 0, y: 20 }}
                  animate={{ rotateX: 0, opacity: 1, y: 0 }}
                  exit={{ rotateX: -90, opacity: 0, y: -20 }}
                  transition={{ type: 'spring', damping: 20, stiffness: 200 }}
                  style={{ transformOrigin: 'bottom' }}
                  onClick={handleCalculateScore}
                  disabled={isCalculatingScore || !allAgent2CorrectionsResolved}
                  className={`absolute bottom-8 right-8 z-30 flex items-center gap-2 px-5 py-3 rounded-full shadow-xl font-medium transition-transform active:scale-95 ${
                    isCalculatingScore || !allAgent2CorrectionsResolved
                      ? 'bg-ios-bg-tertiary text-ios-label-tertiary cursor-not-allowed'
                      : 'bg-[#0071e3] hover:bg-[#0077ed] text-white'
                  }`}
                >
                  {isCalculatingScore ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                  Calculate Defense Readiness Score
                </motion.button>
              )}
              {agent2State === 'completed' && activeTab === 'agent2' && agent2ScoreCalculated && (
                <motion.button
                  key="download-bottom"
                  initial={{ rotateX: -90, opacity: 0, y: -20 }}
                  animate={{ rotateX: 0, opacity: 1, y: 0 }}
                  exit={{ rotateX: 90, opacity: 0, y: 20 }}
                  whileHover="hover"
                  whileTap="tap"
                  variants={{
                    hover: { scale: 1.03 },
                    tap: { scale: 0.95 }
                  }}
                  transition={{ type: 'spring', damping: 20, stiffness: 200 }}
                  style={{ transformOrigin: 'top' }}
                  onClick={handleDownload}
                  className="absolute bottom-8 right-8 z-30 flex items-center gap-2 text-white px-5 py-3 rounded-full font-medium transition-transform active:scale-95 animate-alive-jiggle apple-3d-glass-green group"
                >
                  <GoogleDownloadIcon size={18} />
                  Download Thesis
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>
        </main>
      </div>

      {/* Ink Burn SVG Filter Definition */}
      <svg style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }} aria-hidden="true">
        <filter id="ink-burn" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.025" numOctaves="5" seed="1" result="noise" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="noiseAlpha" />
          <feComponentTransfer in="noiseAlpha" result="mask">
            <feFuncA type="linear" slope="10" intercept="var(--burn-intercept, -5)" />
          </feComponentTransfer>
          <feGaussianBlur stdDeviation="0.4" in="mask" result="softMask" />
          <feComposite in="SourceGraphic" in2="softMask" operator="in" />
        </filter>
      </svg>
    </div>
  );
}

