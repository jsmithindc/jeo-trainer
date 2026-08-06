// Run once on your Mac to upload all painting images to Supabase Storage
// Usage: cd ~/Downloads/jeopardy-pwa-clean && node scripts/upload-paintings.mjs

import { createClient } from '@supabase/supabase-js'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'

const SUPABASE_URL = 'https://uramupgwxuugdcmmklds.supabase.co'
const SUPABASE_KEY = 'sb_publishable_qJMYyHDRF18PWU6S4nqewA_bi1SDSEM'
const PROXY_BASE = 'https://jeotrainer.netlify.app/.netlify/functions/imgproxy'
const BUCKET = 'paintings'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const paintings = [
  ['mona_lisa', 'title=Mona_Lisa'],
  ['the_last_supper', 'title=The_Last_Supper_(Leonardo)'],
  ['creation_of_adam', 'title=The_Creation_of_Adam'],
  ['school_of_athens', 'title=The_School_of_Athens'],
  ['birth_of_venus', 'title=The_Birth_of_Venus'],
  ['the_night_watch', 'title=The_Night_Watch'],
  ['girl_pearl_earring', 'title=Girl_with_a_Pearl_Earring'],
  ['third_of_may', 'title=The_Third_of_May_1808'],
  ['liberty_leading', 'title=Liberty_Leading_the_People'],
  ['fighting_temeraire', 'title=The_Fighting_Temeraire'],
  ['water_lilies', 'title=Water_Lilies_Monet'],
  ['impression_sunrise', 'title=Impression,_Sunrise'],
  ['luncheon_boating', 'title=Luncheon_of_the_Boating_Party'],
  ['dance_class', 'title=The_Dance_Class_Degas'],
  ['sunday_grande_jatte', 'title=A_Sunday_on_La_Grande_Jatte'],
  ['card_players', 'title=The_Card_Players_Cezanne'],
  ['where_do_we_come_from', 'title=Where_Do_We_Come_From_Gauguin'],
  ['starry_night', 'title=The_Starry_Night'],
  ['sunflowers', 'title=Sunflowers_Van_Gogh'],
  ['the_scream', 'title=The_Scream'],
  ['the_kiss', 'title=The_Kiss_(Klimt)'],
  ['guernica', 'title=Guernica'],
  ['les_demoiselles', 'title=Les_Demoiselles_d%27Avignon'],
  ['dance_matisse', 'title=Dance_(Matisse)'],
  ['american_gothic', 'title=American_Gothic'],
  ['nighthawks', 'title=Nighthawks'],
  ['arnolfini_portrait', 'title=Arnolfini_Portrait'],
  ['garden_earthly_delights', 'title=The_Garden_of_Earthly_Delights'],
  ['las_meninas', 'title=Las_Meninas'],
  ['calling_saint_matthew', 'title=The_Calling_of_Saint_Matthew'],
  ['death_of_marat', 'title=The_Death_of_Marat'],
  ['wanderer_sea_fog', 'title=Wanderer_above_the_Sea_of_Fog'],
  ['hunters_in_snow', 'title=The_Hunters_in_the_Snow'],
  ['composition_viii', 'title=Composition_VIII_Kandinsky'],
  ['broadway_boogie', 'title=Broadway_Boogie-Woogie'],
  ['descent_from_cross', 'title=Descent_from_the_Cross_Rubens'],
  ['durer_self_portrait', 'title=Albrecht_Dürer_self-portrait_1500'],
  ['campbell_soup', 'title=Campbell_Soup_Cans_Warhol'],
  ['no_31', 'title=One:_Number_31,_1950'],
  ['gross_clinic', 'title=The_Gross_Clinic'],
  ['gulf_stream', 'title=The_Gulf_Stream_(painting)'],
  ['the_cradle', 'title=The_Cradle_(Morisot)'],
  ['childs_bath', 'title=The_Child%27s_Bath'],
  ['egon_schiele', 'title=Egon_Schiele'],
  ['jimson_weed', 'title=Jimson_Weed_Georgia_OKeeffe'],
  ['man_at_crossroads', 'title=Man_at_the_Crossroads_Rivera'],
  // Locally downloaded ones
  ['two_fridas', null],
  ['orange_yellow', null],
  ['whaam', null],
  ['son_of_man', null],
  ['basquiat_skull', null],
  ['girl_balloon', null],
]

async function main() {
  // Create bucket
  await supabase.storage.createBucket(BUCKET, { public: true }).catch(() => {})

  const urls = {}
  for (const [filename, query] of paintings) {
    try {
      let data
      if (!query) {
        const localPath = `./public/paintings/${filename}.jpg`
        if (!existsSync(localPath)) { console.log(`⚠ Missing local file: ${localPath}`); continue }
        data = await readFile(localPath)
      } else {
        const res = await fetch(`${PROXY_BASE}?${query}`)
        if (!res.ok) { console.log(`⚠ Proxy failed ${filename}: ${res.status}`); continue }
        data = Buffer.from(await res.arrayBuffer())
      }

      const { error } = await supabase.storage.from(BUCKET).upload(`${filename}.jpg`, data, {
        contentType: 'image/jpeg', upsert: true
      })
      if (error) { console.log(`✗ ${filename}: ${error.message}`); continue }

      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(`${filename}.jpg`)
      urls[filename] = urlData.publicUrl
      console.log(`✓ ${filename}`)
    } catch (e) {
      console.log(`✗ ${filename}: ${e.message}`)
    }
    await new Promise(r => setTimeout(r, 300))
  }

  console.log('\n✅ All done! Paste these URLs into drills.jsx:')
  Object.entries(urls).forEach(([k, v]) => console.log(`  ${k}: ${v}`))
}

main()
