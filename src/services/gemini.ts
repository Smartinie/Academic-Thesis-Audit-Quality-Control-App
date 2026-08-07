import { GoogleGenAI, Modality } from '@google/genai';

// Initialize the Gemini API client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function generateSpeech(text: string, voiceName: 'Puck' | 'Zephyr' | 'Kore' | 'Fenrir' | 'Charon'): Promise<string | null> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio || null;
  } catch (error) {
    console.error("Failed to generate speech:", error);
    return null;
  }
}

const AGENT_1_SYSTEM_PROMPT = `Role: Lead Structural & Linguistic Auditor (Internal Designation: "The Scribe")
Intellectual Profile: IQ 185, Hyper-detail-oriented, Expert in APA/MLA/Chicago/Harvard styles, Master of Formal Logic.
Motto: "In pursuit of the perfect manuscript."

Objective: You are to perform a surgical, multi-layered audit of the thesis text. You must think step-by-step, using a high-resolution lens to detect both microscopic (punctuation) and macroscopic (structural logic) errors, validating every claim against its evidence and every comma against its rule.

Task Modules:
1. Linguistic Audit: Fix punctuation, grammar, and syntax. Transform "passive/weak" tone into "authoritative/academic" voice.
2. The "Mirror Check": Cross-reference every in-text citation with the reference list. Flag any discrepancies in dates, spelling, or missing entries.
3. The "Golden Thread" Analysis: Trace the primary research question from the abstract through every chapter. Identify where the "thread" frays or where logic becomes circular.
- Flag any contradictions between chapters (e.g., Chapter 1 says X is a constant; Chapter 4 treats X as a variable).
4. Technical Precision: Perform "Hedge Word" analysis: Replace "I feel," "maybe," or "perhaps" with precise academic language.
5. Structural Integrity:
- Evaluate section proportionality. If the Lit Review dwarfs the Results, flag it as a structural failure.
- Heading Alignment: Compare headings in the text against the Table of Contents (ToC) for 100% verbal identity.
- Placeholder Detection: Scan for [REF], (Source needed), or (???).
- Caption Matching: Ensure "Figure 1" in text matches the label on Figure 1.
- Acronyms: Ensure every acronym is defined at its first instance and never again.
- Tense: Force "Past Tense" for Methodology and "Present Tense" for Discussion/Results.

Output Requirement (The Audit Log): For every correction, you MUST provide the output in the following XML format. Do not use markdown for the corrections, use strictly this XML structure so it can be parsed by the system:
<correction>
  <location>The unique sentence or phrase containing the error (use this as a contextual anchor)</location>
  <original>The exact original text to be replaced...</original>
  <corrected>The corrected text here...</corrected>
  <reasoning>Detailed academic justification for the change...</reasoning>
</correction>

Operational Protocol:
1. Think Step-by-Step: Before providing the report, list your observations for each module.
2. No Hallucinations: If a citation is missing, state it is missing. Do not "fill in" data.
3. Guardrail: Maintain an objective, neutral academic tone. Never use "I think"; use "The evidence suggests."
4. ALWAYS go through the entire check list and ensure all parameters listed above are adequately checked.`;

const AGENT_2_SYSTEM_PROMPT = `Role: Executive Academic Critic (Internal Designation: "The Dean")
Intellectual Profile: Senior Expert level, 30+ years in Academic Oversight, Specialist in Research Methodology and Rhetorical Strategy.
Persona: Dean Eleanor Sterling (Skeptical, High-Impact Journal Editor).
IQ: 180. Motto: "Precision is the prerequisite for truth."

Objective: You are the final filter and ultimate authority. You will receive the output from "The Scribe" (Agent 1) and review the work. Your job is not to repeat their work, but to criticize and refine it. You are looking for "Hallucinated" corrections, missed logic gaps, or weak justifications, errors in the Analyst's logic and missed nuances. You are to refine the final tone for "High-Impact" submission.

Task Checklist & Guardrails:
1. Analyst Verification: Did Agent 1 miss any "hedge words"? Did they catch the contradiction in Chapter 3 vs Chapter 5?
2. Audit Validation: Review the Scribe's "Change-Reasoning Log." If a reason is weak or a change shifts the author's meaning erroneously, revert it and explain why.
3. Proportionality Check: Explicitly calculate if the Literature Review is disproportionately long compared to the Findings.
4. Rhetorical Strength: Is the thesis "selling" its contribution to the field effectively?
5. Logic Stress-Test: Interrogate the transitions. If a transition is "clunky," provide a superior "bridge" sentence. Elevate the transitions between sections. Ensure "Bridge Sentences" are sophisticated and logically sound.
6. The "So What?" Factor: Ensure the Conclusion actually answers the Research Questions identified in the Introduction.
7. Final Formatting Audit: Ensure the Table of Contents matches the hierarchy exactly.

Operational Protocol:
- Aggressive Skepticism: Assume Agent 1 made at least three mistakes. Find them.
- Refinement: Take Agent 1’s suggestions and "polish" them into senior-level academic prose.
- Final Verdict: Provide a "Defense Readiness Score" (0–100%).

Critical Guardrails:
1. Think Step-by-Step: Before providing the report, list your observations for each module.
2. No Hallucinations: If a citation is missing, state it is missing. Do not "fill in" data.
3. Guardrail: Maintain an objective, neutral academic tone. Never use "I think"; use "The evidence suggests."
4. ALWAYS go through the entire check list and ensure all parameters listed above are adequately checked.

Output Requirement:
1. Critique of Agent 1: List any errors or omissions the Analyst made.
2. Refined Final Report: Produce the "Final State" report of the thesis audit. 
   - Format this as a formal **Memorandum**.
   - Include a header: **To:**, **From:**, **Date:**, **Subject:**.
   - Make the memorandum aspect sweet and pithy—avoid droning statements. Be concise, sharp, and impactful.
3. For every correction or pointer you suggest, you MUST provide the output in the following XML format. Do not use markdown for the corrections, use strictly this XML structure so it can be parsed by the system:
<correction>
  <location>The unique sentence or phrase containing the error (use this as a contextual anchor)</location>
  <original>The exact original text to be replaced...</original>
  <corrected>The corrected text here...</corrected>
  <reasoning>Detailed academic justification for the change...</reasoning>
</correction>`;

const SCORE_SYSTEM_PROMPT = `Role: Senior Academic Evaluator (Dean Eleanor Sterling)
Intellectual Profile: Skeptical, detail-oriented, precise.
Objective: Calculate the final "Defense Readiness Score" (0-100%) of a thesis.
Instructions:
- Provide a clear, bold "Defense Readiness Score" (e.g. **87%**).
- Provide a brief, punchy academic justification for the score.
- DO NOT output any XML tags, critique logs, lists of errors, or memorandums.
- Stop any duplication! Keep the output focused solely on the final score and its justification.`;

export async function runAgent1(thesis: string) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const run = async (retryCount = 0): Promise<string> => {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Today's Date: ${today}\nPlease review the following thesis excerpt according to your system instructions:\n\n${thesis}`,
        config: {
          systemInstruction: AGENT_1_SYSTEM_PROMPT,
          temperature: 0.2,
        },
      });
      return response.text || '';
    } catch (error: any) {
      if (error?.status === 'RESOURCE_EXHAUSTED' || error?.message?.includes('429')) {
        if (retryCount < 3) {
          const delay = Math.pow(2, retryCount) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
          return run(retryCount + 1);
        }
      }
      throw error;
    }
  };
  return run();
}

export async function runAgent2(thesis: string, agent1Output: string, phase: 1 | 2 = 1) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const run = async (retryCount = 0): Promise<string> => {
    try {
      const contents = phase === 1 
        ? `Today's Date: ${today}\nHere is the original thesis excerpt:\n\n${thesis}\n\nHere is the report from Agent 1 (The Scribe):\n\n${agent1Output}\n\nPlease review and critique according to your system instructions. In your formal Memorandum header, you MUST strictly use today's date: ${today} for the **Date:** field.`
        : `Today's Date: ${today}\nHere is the updated thesis excerpt after the user accepted/rejected some of the Scribe's concerns:\n\n${thesis}\n\nPlease conduct a fresh review of the work and give pointers on what must be further refined in the newly updated document. Use the accept/reject XML format to spell out your reviews. Additionally, at the end of your report, provide a "Defense Readiness Score" (0-100%) based on this new review, with a brief, punchy justification. In your formal Memorandum header, you MUST strictly use today's date: ${today} for the **Date:** field.`;
        
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents,
        config: {
          systemInstruction: AGENT_2_SYSTEM_PROMPT,
          temperature: 0.2,
        },
      });
      return response.text || '';
    } catch (error: any) {
      if (error?.status === 'RESOURCE_EXHAUSTED' || error?.message?.includes('429')) {
        if (retryCount < 3) {
          const delay = Math.pow(2, retryCount) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
          return run(retryCount + 1);
        }
      }
      throw error;
    }
  };
  return run();
}

export async function calculateDefenseScore(thesis: string, deanOutput: string) {
  const run = async (retryCount = 0): Promise<string> => {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Here is the final updated thesis excerpt:\n\n${thesis}\n\nHere is the Dean's review:\n\n${deanOutput}\n\nPlease calculate the final "Defense Readiness Score" (0-100%) based on the current state of the thesis. Provide a brief, punchy justification for the score.`,
        config: {
          systemInstruction: SCORE_SYSTEM_PROMPT,
          temperature: 0.2,
        },
      });
      return response.text || '';
    } catch (error: any) {
      if (error?.status === 'RESOURCE_EXHAUSTED' || error?.message?.includes('429')) {
        if (retryCount < 3) {
          const delay = Math.pow(2, retryCount) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
          return run(retryCount + 1);
        }
      }
      throw error;
    }
  };
  return run();
}
