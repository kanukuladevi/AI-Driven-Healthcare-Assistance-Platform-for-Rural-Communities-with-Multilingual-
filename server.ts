import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3000;

// Express json parser with 20MB limit for scanned prescription image uploads
app.use(express.json({ limit: '20mb' }));

// Initialize server-side Gemini client with User-Agent telemetry
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Database state simulation with realistic Telangana rural healthcare context
interface Patient {
  id: string;
  name: string;
  mobile: string;
  age: number;
  gender: string;
  village: string;
  district: string;
  preferredLanguage: string; // 'te' (Telugu), 'hi' (Hindi), 'ta' (Tamil), 'kn' (Kannada), 'bn' (Bengali), 'en' (English)
  healthId: string;
  chronicConditions: string[];
  registeredDate: string;
}

interface MedicationItem {
  id: string;
  medicineName: string;
  form: string; // 'Tablet', 'Capsule', 'Syrup', 'Sachet', 'Injection'
  dosage: string; // '500 mg', '250 mg', '10 ml'
  frequencyCode: string; // '1-0-1', '1-1-1', '0-0-1'
  scheduleTimes: {
    morning: boolean;
    afternoon: boolean;
    night: boolean;
  };
  relationToFood: 'after_food' | 'before_food' | 'with_water';
  durationDays: number;
  doctorInstruction: string;
  simplifiedExplanation: string;
  precautions: string;
  purposeSimple: string;
}

interface PrescriptionRecord {
  id: string;
  patientId: string;
  doctorName: string;
  facilityName: string;
  visitDate: string;
  diagnosis: string;
  diagnosisExplanation: string;
  doctorAdvice: string;
  reviewDays: number;
  medications: MedicationItem[];
  medicalTermsSimplified: { term: string; simpleMeaning: string }[];
  uploadedAt: string;
  imageUrl?: string;
  verifiedByAsha: boolean;
  ashaNotes?: string;
}

interface MedicationReminder {
  id: string;
  patientId: string;
  prescriptionId: string;
  medicineName: string;
  dosage: string;
  timeSlot: 'Morning' | 'Afternoon' | 'Night';
  scheduledTime: string; // '08:00 AM'
  relationToFood: string;
  takenToday: boolean;
  takenAt?: string;
}

interface AshaWorker {
  id: string;
  name: string;
  role: string;
  phone: string;
  assignedVillage: string;
  assignedPatientsCount: number;
  pendingHomeVisits: number;
}

// Initial in-memory mock PostgreSQL state
let patients: Patient[] = [
  {
    id: 'pat-001',
    name: 'Lakshmi Narayana',
    mobile: '98480 12345',
    age: 54,
    gender: 'Male',
    village: 'Narsampet',
    district: 'Warangal, Telangana',
    preferredLanguage: 'te',
    healthId: 'ABHA-8921-4321-0092',
    chronicConditions: ['Type 2 Diabetes', 'Hypertension'],
    registeredDate: '2026-08-14',
  },
  {
    id: 'pat-002',
    name: 'Sunita Sharma',
    mobile: '98765 43210',
    age: 38,
    gender: 'Female',
    village: 'Phoolgaon',
    district: 'Rural Pune',
    preferredLanguage: 'hi',
    healthId: 'ABHA-3310-9942-1102',
    chronicConditions: ['Acute Pharyngitis'],
    registeredDate: '2026-10-14',
  },
  {
    id: 'pat-003',
    name: 'Ravi Kumar',
    mobile: '94401 56789',
    age: 62,
    gender: 'Male',
    village: 'Chennaraopet',
    district: 'Warangal, Telangana',
    preferredLanguage: 'te',
    healthId: 'ABHA-7711-2283-4901',
    chronicConditions: ['Joint Pain / Arthritis'],
    registeredDate: '2026-09-20',
  },
];

let prescriptions: PrescriptionRecord[] = [
  {
    id: 'rx-101',
    patientId: 'pat-002',
    doctorName: 'Dr. Mahesh Patil (M.B.B.S.)',
    facilityName: 'Primary Health Centre (PHC) Phoolgaon',
    visitDate: '2026-10-14',
    diagnosis: 'Acute Pharyngitis (Throat Infection)',
    diagnosisExplanation: 'గొంతు వాపు మరియు ఇన్ఫెక్షన్ వల్ల నొప్పి (Throat swelling & infection causing pain)',
    doctorAdvice: 'Rest, drink warm water, avoid cold items. Review after 3 days.',
    reviewDays: 3,
    verifiedByAsha: true,
    ashaNotes: 'Patient visited PHC on 14th Oct. Advised steam inhalation twice daily.',
    uploadedAt: '2026-10-14T10:30:00Z',
    imageUrl: '/src/assets/images/rural_prescription_sample_1793591392814.jpg',
    medicalTermsSimplified: [
      {
        term: 'Acute Pharyngitis',
        simpleMeaning: 'గొంతు లోపల ఇన్ఫెక్షన్ లేదా మంట వల్ల గొంతు నొప్పి రావడం (Swelling and pain in the throat due to infection)',
      },
      {
        term: 'Oral Rehydration Salts (ORS)',
        simpleMeaning: 'శరీరంలో తగ్గిన నీరు మరియు లవణాలను తిరిగి ఇచ్చే జీవన ద్రావణం (Electrolyte drink to restore body water and salts)',
      },
    ],
    medications: [
      {
        id: 'med-1',
        medicineName: 'Tab. Paracetamol',
        form: 'Tablet',
        dosage: '500 mg',
        frequencyCode: '1 - 0 - 1',
        scheduleTimes: { morning: true, afternoon: false, night: true },
        relationToFood: 'after_food',
        durationDays: 3,
        doctorInstruction: 'Tab. Paracetamol 500mg, Dose: 1 - 0 - 1 (After food for 3 days)',
        simplifiedExplanation: 'ఉదయం 1 బిళ్ళ, రాత్రి 1 బిళ్ళ భోజనం లేదా అల్పాహారం తిన్న తర్వాత వేసుకోవాలి.',
        precautions: 'పచ్చి కడుపుతో (ఖాళీ కడుపుతో) తీసుకోకూడదు. జ్వరం, నొప్పి తగ్గేవరకు మాత్రమే వాడాలి.',
        purposeSimple: 'జ్వరం మరియు గొంతు నొప్పి తగ్గించడానికి (For reducing fever and throat pain)',
      },
      {
        id: 'med-2',
        medicineName: 'Cap. Amoxicillin',
        form: 'Capsule',
        dosage: '250 mg',
        frequencyCode: '1 - 1 - 1',
        scheduleTimes: { morning: true, afternoon: true, night: true },
        relationToFood: 'after_food',
        durationDays: 5,
        doctorInstruction: 'Cap. Amoxicillin 250mg, Dose: 1 - 1 - 1 (After food for 5 days)',
        simplifiedExplanation: 'ఉదయం 1 కాప్సూల్, మధ్యాహ్నం 1 కాప్సూల్, రాత్రి 1 కాప్సూల్ తిన్న తర్వాత మింగాలి.',
        precautions: 'మధ్యలో ఆపకూడదు. డాక్టర్ చెప్పిన 5 రోజులు పూర్తి కోర్సు వాడాలి. అప్పుడే ఇన్ఫెక్షన్ పూర్తిగా పోతుంది.',
        purposeSimple: 'గొంతులోని సూక్ష్మక్రిములను చంపే యాంటీబయోటిక్ (Antibiotic to fight bacteria in throat)',
      },
      {
        id: 'med-3',
        medicineName: 'ORS Sachets',
        form: 'Sachet',
        dosage: '1 Sachet in 1 Litre boiled & cooled water',
        frequencyCode: 'Throughout day',
        scheduleTimes: { morning: true, afternoon: true, night: false },
        relationToFood: 'with_water',
        durationDays: 3,
        doctorInstruction: 'Dissolve 1 sachet in 1 liter of boiled & cooled water. Drink plenty throughout the day.',
        simplifiedExplanation: '1 ప్యాకెట్ పొడిని కాచి చల్లార్చిన ఒక లీటర్ నీటిలో పూర్తిగా కలిపి, రోజంతా కొద్దికొద్దిగా తాగాలి.',
        precautions: 'కలిపిన 24 గంటల తర్వాత మిగిలిన నీటిని పారబోసి, మరుసటి రోజు కొత్త ప్యాకెట్ కలుపుకోవాలి.',
        purposeSimple: 'శరీరంలో నీరసం రాకుండా నీటి శాతం కాపాడటానికి (Prevents dehydration & weakness)',
      },
    ],
  },
  {
    id: 'rx-102',
    patientId: 'pat-001',
    doctorName: 'Dr. K. Srinivas Rao (M.D. Gen. Med)',
    facilityName: 'Community Health Centre (CHC) Narsampet',
    visitDate: '2026-10-02',
    diagnosis: 'Type 2 Diabetes Mellitus & Essential Hypertension',
    diagnosisExplanation: 'రక్తంలో చక్కెర శాతం ఎక్కువ ఉండటం మరియు అధిక రక్తపోటు (High sugar in blood & high BP)',
    doctorAdvice: 'Avoid sugar, reduce salt in curries, walk 30 minutes daily in morning, check BP weekly at Sub-centre.',
    reviewDays: 30,
    verifiedByAsha: true,
    ashaNotes: 'Checked BP on 20th Oct: 130/84 mmHg. Patient taking morning doses regularly.',
    uploadedAt: '2026-10-02T11:00:00Z',
    medicalTermsSimplified: [
      {
        term: 'Type 2 Diabetes',
        simpleMeaning: 'రక్తంలో చక్కెర (షుగర్) పెరిగిపోయే సాధారణ సమస్య. తిండి మరియు మందులతో అదుపులో ఉంచుకోవచ్చు.',
      },
      {
        term: 'Hypertension',
        simpleMeaning: 'రక్తనాళాలలో రక్తపోటు (బీపీ) ఎక్కువ ఉండటం. ఉప్పు తగ్గించి మందులు క్రమం తప్పకుండా వాడాలి.',
      },
    ],
    medications: [
      {
        id: 'med-11',
        medicineName: 'Tab. Metformin',
        form: 'Tablet',
        dosage: '500 mg',
        frequencyCode: '1 - 0 - 1',
        scheduleTimes: { morning: true, afternoon: false, night: true },
        relationToFood: 'after_food',
        durationDays: 30,
        doctorInstruction: 'Tab. Metformin 500mg, Dose: 1 - 0 - 1 (After breakfast & dinner)',
        simplifiedExplanation: 'ఉదయం టిఫిన్ తిన్న తర్వాత 1 బిళ్ళ, రాత్రి భోజనం తర్వాత 1 బిళ్ళ తప్పనిసరిగా వేసుకోవాలి.',
        precautions: 'షుగర్ మందులను ఎప్పుడూ ఆపకూడదు. కళ్ళు తిరిగితే కొద్దిగా గ్లూకోజ్ లేదా పాలు తీసుకోవాలి.',
        purposeSimple: 'రక్తంలో షుగర్ స్థాయిని అదుపులో ఉంచడానికి (Controls blood sugar)',
      },
      {
        id: 'med-12',
        medicineName: 'Tab. Telmisartan',
        form: 'Tablet',
        dosage: '40 mg',
        frequencyCode: '1 - 0 - 0',
        scheduleTimes: { morning: true, afternoon: false, night: false },
        relationToFood: 'with_water',
        durationDays: 30,
        doctorInstruction: 'Tab. Telmisartan 40mg, Dose: 1 - 0 - 0 (Morning empty stomach or with light breakfast)',
        simplifiedExplanation: 'రోజూ ఉదయం 8 గంటలకు ఒక గ్లాసు నీటితో 1 బిళ్ళ వేసుకోవాలి.',
        precautions: 'బీపీ సాధారణ స్థితికి వచ్చినా సరే డాక్టర్ చెప్పకుండా మందు మానకూడదు.',
        purposeSimple: 'రక్తపోటును (బీపీ) స్థిరంగా ఉంచడానికి (Maintains healthy blood pressure)',
      },
    ],
  },
];

let reminders: MedicationReminder[] = [
  {
    id: 'rem-1',
    patientId: 'pat-001',
    prescriptionId: 'rx-102',
    medicineName: 'Tab. Telmisartan 40mg',
    dosage: '1 Tablet',
    timeSlot: 'Morning',
    scheduledTime: '08:00 AM',
    relationToFood: 'With water / Light breakfast',
    takenToday: true,
    takenAt: '08:15 AM',
  },
  {
    id: 'rem-2',
    patientId: 'pat-001',
    prescriptionId: 'rx-102',
    medicineName: 'Tab. Metformin 500mg',
    dosage: '1 Tablet',
    timeSlot: 'Morning',
    scheduledTime: '08:30 AM',
    relationToFood: 'After morning breakfast',
    takenToday: true,
    takenAt: '08:45 AM',
  },
  {
    id: 'rem-3',
    patientId: 'pat-001',
    prescriptionId: 'rx-102',
    medicineName: 'Tab. Metformin 500mg',
    dosage: '1 Tablet',
    timeSlot: 'Night',
    scheduledTime: '08:30 PM',
    relationToFood: 'After dinner',
    takenToday: false,
  },
  {
    id: 'rem-4',
    patientId: 'pat-002',
    prescriptionId: 'rx-101',
    medicineName: 'Tab. Paracetamol 500mg',
    dosage: '1 Tablet',
    timeSlot: 'Morning',
    scheduledTime: '08:30 AM',
    relationToFood: 'After breakfast',
    takenToday: true,
    takenAt: '08:20 AM',
  },
  {
    id: 'rem-5',
    patientId: 'pat-002',
    prescriptionId: 'rx-101',
    medicineName: 'Cap. Amoxicillin 250mg',
    dosage: '1 Capsule',
    timeSlot: 'Afternoon',
    scheduledTime: '01:30 PM',
    relationToFood: 'After lunch',
    takenToday: false,
  },
  {
    id: 'rem-6',
    patientId: 'pat-002',
    prescriptionId: 'rx-101',
    medicineName: 'ORS Rehydration Solution',
    dosage: '1 Glass',
    timeSlot: 'Afternoon',
    scheduledTime: '03:30 PM',
    relationToFood: 'Throughout afternoon',
    takenToday: false,
  },
];

let ashaWorkers: AshaWorker[] = [
  {
    id: 'asha-01',
    name: 'Sunita Bai',
    role: 'Senior ASHA Community Worker',
    phone: '98499 11223',
    assignedVillage: 'Narsampet Rural Cluster 3 & 4',
    assignedPatientsCount: 24,
    pendingHomeVisits: 3,
  },
  {
    id: 'asha-02',
    name: 'Kavitha Devi',
    role: 'ANM (Auxiliary Nurse Midwife)',
    phone: '98499 55667',
    assignedVillage: 'Chennaraopet Sub-Centre',
    assignedPatientsCount: 31,
    pendingHomeVisits: 5,
  },
];

let villageBulletins = [
  {
    id: 'b-1',
    title: 'Free Village NCD & Sugar Screening Camp',
    date: 'Wednesday, Nov 5th at Gram Panchayat Hall',
    description: 'Dr. Ramesh from Narsampet CHC will conduct free blood pressure, sugar, and eye tests. All elders 40+ are requested to attend.',
    category: 'Camp',
  },
  {
    id: 'b-2',
    title: 'Seasonal Fever & Mosquito Precaution Alert',
    date: 'Active Notice',
    description: 'Due to recent rains, empty water drums and coconut shells around houses to prevent dengue mosquito breeding. Report high fever immediately to ASHA.',
    category: 'Alert',
  },
];

// Language map helper for prompt guidance
const LANGUAGE_NAMES: Record<string, string> = {
  te: 'Telugu (తెలుగు)',
  hi: 'Hindi (हिन्दी)',
  ta: 'Tamil (தமிழ்)',
  kn: 'Kannada (ಕನ್ನಡ)',
  bn: 'Bengali (বাংলা)',
  en: 'English',
};

// API 1: Extract prescription via Gemini 3.8 Flash OCR & Multilingual Simplification
app.post('/api/gemini/extract-prescription', async (req, res) => {
  try {
    const { imageBase64, samplePreset, targetLanguage = 'te', patientName } = req.body;
    const targetLangName = LANGUAGE_NAMES[targetLanguage] || 'Telugu';

    let contentParts: any[] = [];

    const systemPrompt = `You are an expert clinical document OCR and multilingual healthcare communication specialist designed for rural Indian healthcare (bridging village patients, ASHA health workers, and Primary Health Centres).
CRITICAL CLINICAL SAFETY PRINCIPLES:
1. PRESERVE DOCTOR INSTRUCTIONS: Accurately transcribe doctor's exact written medicines, dosage (mg/ml), frequency (e.g. 1-0-1, 1-1-1, 1-0-0), and duration. NEVER invent, hallucinate, or alter doctor's dosage instructions.
2. PATIENT SIMPLIFICATION: Translate and explain the verified instructions into simple, culturally respectful, colloquial ${targetLangName} that an elderly or non-literate rural villager can understand.
3. EXPLAIN MEDICAL TERMS: Convert clinical terms (e.g., Acute Pharyngitis, Hypertension, Diabetes, Dehydration) into everyday plain language in ${targetLangName} (e.g., "గొంతు నొప్పి మరియు మంట", "రక్తపోటు / బీపీ", "చక్కెర వ్యాధి / షుగర్").
4. EMPHASIZE RELATION TO FOOD: Clarify clearly whether each medicine must be taken after food (భోజనం తర్వాత), before food (భోజనానికి ముందు), or with plenty of boiled water.
5. YOU ARE A HEALTHCARE SUPPORT TOOL, NOT AN INDEPENDENT DOCTOR: Do not independently diagnose or prescribe new medicines. Include clear instructions to consult the doctor if symptoms worsen.`;

    if (imageBase64) {
      // Strip base64 prefix if provided
      const cleanedBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
      contentParts = [
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: cleanedBase64,
          },
        },
        {
          text: `Extract all medical details from this prescription image. Provide complete simplified explanations and precautions in ${targetLangName}.`,
        },
      ];
    } else if (samplePreset === 'phc_sunita' || !imageBase64) {
      // Use the verified image from the filesystem if exists
      const samplePath = path.join(process.cwd(), 'src/assets/images/rural_prescription_sample_1793591392814.jpg');
      if (fs.existsSync(samplePath)) {
        const fileBuffer = fs.readFileSync(samplePath);
        const base64Data = fileBuffer.toString('base64');
        contentParts = [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: base64Data,
            },
          },
          {
            text: `Extract all prescription details from this official Indian PHC prescription photo for ${patientName || 'Mrs. Sunita Sharma'}. Provide all patient explanations in ${targetLangName}.`,
          },
        ];
      } else {
        contentParts = [
          {
            text: `Extract and simplify this medical prescription text for ${patientName || 'Sunita Sharma'}:
Doctor: Dr. Mahesh Patil (M.B.B.S.), PHC Phoolgaon
Diagnosis: Acute Pharyngitis (Throat Infection)
Rx:
1. Tab. Paracetamol 500mg - Qty: 10 tabs, Dose: 1-0-1 (After food for 3 days)
2. Cap. Amoxicillin 250mg - Qty: 15 caps, Dose: 1-1-1 (After food for 5 days)
3. ORS (Oral Rehydration Salts) Sachets (W.H.O. Formula) - Qty: 3 sachets, Dose: Dissolve 1 sachet in 1 liter boiled & cooled water. Drink plenty throughout day.
Advice: Rest, drink warm water, avoid cold items. Review after 3 days.

Translate and simplify everything clearly into ${targetLangName}.`,
          },
        ];
      }
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: { parts: contentParts },
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            doctorName: { type: Type.STRING },
            facilityName: { type: Type.STRING },
            visitDate: { type: Type.STRING },
            diagnosis: { type: Type.STRING },
            diagnosisExplanation: { type: Type.STRING, description: `Simplified diagnosis in ${targetLangName}` },
            doctorAdvice: { type: Type.STRING },
            reviewDays: { type: Type.INTEGER },
            generalPrecautions: { type: Type.STRING, description: `General lifestyle advice in ${targetLangName}` },
            medicalTermsSimplified: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  term: { type: Type.STRING },
                  simpleMeaning: { type: Type.STRING, description: `Simple explanation in ${targetLangName}` },
                },
                required: ['term', 'simpleMeaning'],
              },
            },
            medications: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  medicineName: { type: Type.STRING },
                  form: { type: Type.STRING, description: 'Tablet, Capsule, Syrup, Sachet' },
                  dosage: { type: Type.STRING, description: 'e.g. 500mg' },
                  frequencyCode: { type: Type.STRING, description: 'e.g. 1-0-1' },
                  scheduleTimes: {
                    type: Type.OBJECT,
                    properties: {
                      morning: { type: Type.BOOLEAN },
                      afternoon: { type: Type.BOOLEAN },
                      night: { type: Type.BOOLEAN },
                    },
                    required: ['morning', 'afternoon', 'night'],
                  },
                  relationToFood: {
                    type: Type.STRING,
                    description: 'after_food, before_food, or with_water',
                  },
                  durationDays: { type: Type.INTEGER },
                  doctorInstruction: { type: Type.STRING, description: 'Original verbatim prescription line' },
                  simplifiedExplanation: {
                    type: Type.STRING,
                    description: `Step by step instruction in ${targetLangName}`,
                  },
                  precautions: {
                    type: Type.STRING,
                    description: `Important warnings or do-not-skip notes in ${targetLangName}`,
                  },
                  purposeSimple: {
                    type: Type.STRING,
                    description: `Why this medicine is taken in ${targetLangName}`,
                  },
                },
                required: [
                  'medicineName',
                  'form',
                  'dosage',
                  'frequencyCode',
                  'scheduleTimes',
                  'relationToFood',
                  'durationDays',
                  'doctorInstruction',
                  'simplifiedExplanation',
                  'precautions',
                  'purposeSimple',
                ],
              },
            },
          },
          required: [
            'doctorName',
            'facilityName',
            'diagnosis',
            'diagnosisExplanation',
            'doctorAdvice',
            'reviewDays',
            'medications',
            'medicalTermsSimplified',
          ],
        },
      },
    });

    const parsedJson = JSON.parse(response.text || '{}');
    res.json({ success: true, data: parsedJson });
  } catch (err: any) {
    console.error('Error in extract-prescription:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to extract and translate prescription',
    });
  }
});

// API 2: Voice-based Healthcare Assistance (Conversational rural Q&A with Safety Boundary)
app.post('/api/gemini/voice-assist', async (req, res) => {
  try {
    const { queryText, targetLanguage = 'te', patientContext } = req.body;
    const targetLangName = LANGUAGE_NAMES[targetLanguage] || 'Telugu';

    const systemInstruction = `You are ArogyaSetu, a warm, patient, and compassionate rural healthcare voice assistant supporting villagers in Telangana and across India in ${targetLangName}.
CRITICAL OPERATIONAL RULES:
1. YOU ARE NOT AN INDEPENDENT DOCTOR: Never diagnose illnesses or change drug dosages. Always refer to the verified doctor's prescription.
2. RED FLAG EMERGENCY DETECTION: If the patient reports chest pain, difficulty breathing, sudden paralysis, unconsciousness, severe snake bite, high fever with stiff neck, or profuse vomiting/blood, IMMEDIATELY flag "isEmergency: true", advise calling 108 ambulance immediately, and give the shortest calm emergency guidance in ${targetLangName}.
3. CLARITY FOR ILLITERATE / ELDERLY PATIENTS: Use short, warm sentences, everyday spoken village vernacular, and comforting tone. Avoid dense medical jargon.
4. AUDIO SPEECH OPTIMIZED: The response will be read aloud via text-to-speech, so structure sentences cleanly without asterisks, tables, markdown bullet points, or complex symbols.
5. PRESCRIBED MEDICINE CONTEXT: Here is the patient's current prescription data: ${JSON.stringify(patientContext || {})}`;

    const prompt = `Patient's spoken question: "${queryText}". Answer in spoken ${targetLangName} with clear explanation.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            spokenResponse: {
              type: Type.STRING,
              description: `Warm natural voice reply in ${targetLangName} script for audio reading aloud`,
            },
            englishSummary: {
              type: Type.STRING,
              description: 'Concise English summary for health worker review',
            },
            isEmergency: {
              type: Type.BOOLEAN,
              description: 'True if severe emergency symptoms require immediate 108 hospital visit',
            },
            emergencyAction: {
              type: Type.STRING,
              description: 'Urgent action step if emergency',
            },
            relatedMedicine: {
              type: Type.STRING,
              description: 'Name of the medicine discussed if applicable',
            },
            recommendedFollowUp: {
              type: Type.STRING,
              description: 'Advice to visit PHC or consult ASHA worker',
            },
          },
          required: ['spokenResponse', 'englishSummary', 'isEmergency'],
        },
      },
    });

    const result = JSON.parse(response.text || '{}');
    res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('Error in voice-assist:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to process voice query',
    });
  }
});

// API 3: Simplify a specific medical term or clinical lab test
app.post('/api/gemini/explain-term', async (req, res) => {
  try {
    const { term, targetLanguage = 'te' } = req.body;
    const targetLangName = LANGUAGE_NAMES[targetLanguage] || 'Telugu';

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: `Explain the medical term "${term}" using a simple, relatable village analogy in ${targetLangName}.`,
      config: {
        systemInstruction: `You explain medical words to rural villagers in ${targetLangName} using everyday rural life metaphors (like agriculture, village wells, rivers, pottery). Be brief (2-3 sentences max).`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            term: { type: Type.STRING },
            vernacularTerm: { type: Type.STRING, description: `Equivalent term in ${targetLangName}` },
            simpleExplanation: { type: Type.STRING, description: `Metaphor / simple meaning in ${targetLangName}` },
            whatPatientShouldDo: { type: Type.STRING, description: `Simple care tip in ${targetLangName}` },
          },
          required: ['term', 'vernacularTerm', 'simpleExplanation', 'whatPatientShouldDo'],
        },
      },
    });

    res.json({ success: true, data: JSON.parse(response.text || '{}') });
  } catch (err: any) {
    console.error('Error in explain-term:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API 4: Data store retrieval
app.get('/api/data', (_req, res) => {
  // Calculate analytics
  const totalPatients = patients.length;
  const totalPrescriptions = prescriptions.length;
  const totalReminders = reminders.length;
  const takenReminders = reminders.filter((r) => r.takenToday).length;
  const adherenceRate = totalReminders > 0 ? Math.round((takenReminders / totalReminders) * 100) : 85;

  const languageStats = patients.reduce(
    (acc: Record<string, number>, p) => {
      acc[p.preferredLanguage] = (acc[p.preferredLanguage] || 0) + 1;
      return acc;
    },
    { te: 2, hi: 1, ta: 0, kn: 0, bn: 0, en: 0 }
  );

  res.json({
    patients,
    prescriptions,
    reminders,
    ashaWorkers,
    villageBulletins,
    analytics: {
      totalPatients,
      totalPrescriptions,
      totalReminders,
      adherenceRate,
      languageStats,
      activeAshaWorkers: ashaWorkers.length,
      highRiskFollowUps: ashaWorkers.reduce((acc, w) => acc + w.pendingHomeVisits, 0),
    },
  });
});

// API 5: Register or update patient
app.post('/api/patients', (req, res) => {
  const { name, mobile, age, gender, village, district, preferredLanguage, chronicConditions } = req.body;
  if (!name || !mobile) {
    return res.status(400).json({ error: 'Name and mobile number are required' });
  }

  const existingIdx = patients.findIndex((p) => p.mobile === mobile);
  const patientData: Patient = {
    id: existingIdx >= 0 ? patients[existingIdx].id : `pat-${Date.now().toString().slice(-4)}`,
    name,
    mobile,
    age: Number(age) || 45,
    gender: gender || 'Female',
    village: village || 'Narsampet Rural',
    district: district || 'Warangal, Telangana',
    preferredLanguage: preferredLanguage || 'te',
    healthId: `ABHA-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}-0012`,
    chronicConditions: chronicConditions || ['Routine Health Checkup'],
    registeredDate: new Date().toISOString().split('T')[0],
  };

  if (existingIdx >= 0) {
    patients[existingIdx] = patientData;
  } else {
    patients.unshift(patientData);
  }

  res.json({ success: true, patient: patientData });
});

// API 6: Save newly verified prescription & auto-generate reminders
app.post('/api/prescriptions', (req, res) => {
  const { patientId, doctorName, facilityName, diagnosis, diagnosisExplanation, doctorAdvice, reviewDays, medications, medicalTermsSimplified, imageUrl } = req.body;

  const newPrescription: PrescriptionRecord = {
    id: `rx-${Date.now().toString().slice(-4)}`,
    patientId: patientId || patients[0]?.id || 'pat-001',
    doctorName: doctorName || 'Dr. Medical Officer (PHC)',
    facilityName: facilityName || 'Government Primary Health Centre',
    visitDate: new Date().toISOString().split('T')[0],
    diagnosis: diagnosis || 'Clinical Consultation',
    diagnosisExplanation: diagnosisExplanation || 'వైద్య పరీక్షలు పూర్తయ్యాయి (Consultation completed)',
    doctorAdvice: doctorAdvice || 'Take rest and drink clean boiled water.',
    reviewDays: Number(reviewDays) || 7,
    medications: (medications || []).map((m: any, idx: number) => ({
      ...m,
      id: `med-${Date.now()}-${idx}`,
    })),
    medicalTermsSimplified: medicalTermsSimplified || [],
    uploadedAt: new Date().toISOString(),
    imageUrl: imageUrl || '/src/assets/images/rural_prescription_sample_1793591392814.jpg',
    verifiedByAsha: true,
  };

  prescriptions.unshift(newPrescription);

  // Automatically generate daily reminders based on schedule
  newPrescription.medications.forEach((med, idx) => {
    if (med.scheduleTimes.morning) {
      reminders.push({
        id: `rem-auto-${Date.now()}-${idx}-m`,
        patientId: newPrescription.patientId,
        prescriptionId: newPrescription.id,
        medicineName: `${med.medicineName} (${med.dosage})`,
        dosage: `1 ${med.form}`,
        timeSlot: 'Morning',
        scheduledTime: '08:00 AM',
        relationToFood: med.relationToFood === 'after_food' ? 'After breakfast' : 'Before breakfast',
        takenToday: false,
      });
    }
    if (med.scheduleTimes.afternoon) {
      reminders.push({
        id: `rem-auto-${Date.now()}-${idx}-a`,
        patientId: newPrescription.patientId,
        prescriptionId: newPrescription.id,
        medicineName: `${med.medicineName} (${med.dosage})`,
        dosage: `1 ${med.form}`,
        timeSlot: 'Afternoon',
        scheduledTime: '01:30 PM',
        relationToFood: med.relationToFood === 'after_food' ? 'After lunch' : 'Before lunch',
        takenToday: false,
      });
    }
    if (med.scheduleTimes.night) {
      reminders.push({
        id: `rem-auto-${Date.now()}-${idx}-n`,
        patientId: newPrescription.patientId,
        prescriptionId: newPrescription.id,
        medicineName: `${med.medicineName} (${med.dosage})`,
        dosage: `1 ${med.form}`,
        timeSlot: 'Night',
        scheduledTime: '08:30 PM',
        relationToFood: med.relationToFood === 'after_food' ? 'After dinner' : 'Before dinner',
        takenToday: false,
      });
    }
  });

  res.json({ success: true, prescription: newPrescription, remindersAdded: reminders.length });
});

// API 7: Toggle reminder taken status
app.post('/api/reminders/toggle', (req, res) => {
  const { reminderId } = req.body;
  const rem = reminders.find((r) => r.id === reminderId);
  if (!rem) {
    return res.status(404).json({ error: 'Reminder not found' });
  }

  rem.takenToday = !rem.takenToday;
  rem.takenAt = rem.takenToday
    ? new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : undefined;

  res.json({ success: true, reminder: rem });
});

// API 8: ASHA worker notes & follow-up update
app.post('/api/asha/notes', (req, res) => {
  const { prescriptionId, notes, verified } = req.body;
  const rx = prescriptions.find((p) => p.id === prescriptionId);
  if (rx) {
    rx.ashaNotes = notes;
    if (verified !== undefined) rx.verifiedByAsha = verified;
  }
  res.json({ success: true, prescription: rx });
});

// Serve frontend with Vite dev middleware
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
