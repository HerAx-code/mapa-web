// BARMM (Bangsamoro Autonomous Region in Muslim Mindanao) administrative
// divisions, used to populate cascading Province -> City/Municipality
// dropdowns on patient registration. Barangay stays free text — BARMM has
// ~2,600 barangays, far too many to enumerate usefully. Sources: PhilAtlas /
// Wikipedia, 2026.
//
// Notes:
//  - Sulu was removed from BARMM by the 2024 Supreme Court ruling (formalized
//    by Executive Order No. 91, 2025) and reverted to the Zamboanga
//    Peninsula, so it is excluded here.
//  - Isabela City sits geographically within Basilan but is administratively
//    part of Region IX, not BARMM, so it is excluded from Basilan's list.
//  - Cotabato City is an independent component city; it is its own
//    province-level entry with a single municipality option.
//  - The Special Geographic Area (8 new 2024 municipalities) and any
//    non-BARMM origin (e.g. Region XII patients) are handled by the
//    "Other (not listed)" option in the form, which reveals a free-text field.

export const BARMM_MUNICIPALITIES = {
  'Maguindanao del Norte': [
    'Barira', 'Buldon', 'Datu Blah T. Sinsuat', 'Datu Odin Sinsuat',
    'Kabuntalan', 'Matanog', 'Northern Kabuntalan', 'Parang',
    'Sultan Kudarat', 'Sultan Mastura', 'Talitay', 'Upi',
  ],
  'Maguindanao del Sur': [
    'Ampatuan', 'Buluan', 'Datu Abdullah Sangki', 'Datu Anggal Midtimbang',
    'Datu Hoffer Ampatuan', 'Datu Montawal', 'Datu Paglas', 'Datu Piang',
    'Datu Salibo', 'Datu Saudi Ampatuan', 'Datu Unsay',
    'General Salipada K. Pendatun', 'Guindulungan', 'Mamasapano',
    'Mangudadatu', 'Pagalungan', 'Paglat', 'Pandag', 'Rajah Buayan',
    'Shariff Aguak', 'Shariff Saydona Mustapha', 'South Upi',
    'Sultan sa Barongis', 'Talayan',
  ],
  'Lanao del Sur': [
    'Amai Manabilang', 'Bacolod-Kalawi', 'Balabagan', 'Balindong', 'Bayang',
    'Binidayan', 'Buadiposo-Buntong', 'Bubong', 'Butig', 'Calanogas',
    'Ditsaan-Ramain', 'Ganassi', 'Kapai', 'Kapatagan', 'Lumba-Bayabao',
    'Lumbaca-Unayan', 'Lumbatan', 'Lumbayanague', 'Madalum', 'Madamba',
    'Maguing', 'Malabang', 'Marantao', 'Marawi City', 'Marogong', 'Masiu',
    'Mulondo', 'Pagayawan', 'Piagapo', 'Picong', 'Poona Bayabao', 'Pualas',
    'Saguiaran', 'Sultan Dumalondong', 'Tagoloan II', 'Tamparan', 'Taraka',
    'Tubaran', 'Tugaya', 'Wao',
  ],
  'Basilan': [
    'Akbar', 'Al-Barka', 'Hadji Mohammad Ajul', 'Hadji Muhtamad',
    'Lamitan City', 'Lantawan', 'Maluso', 'Sumisip', 'Tabuan-Lasa',
    'Tipo-Tipo', 'Tuburan', 'Ungkaya Pukan',
  ],
  'Tawi-Tawi': [
    'Bongao', 'Languyan', 'Mapun', 'Panglima Sugala', 'Sapa-Sapa', 'Sibutu',
    'Simunul', 'Sitangkai', 'South Ubian', 'Tandubas', 'Turtle Islands',
  ],
  'Cotabato City': ['Cotabato City'],
}

export const BARMM_PROVINCES = Object.keys(BARMM_MUNICIPALITIES)