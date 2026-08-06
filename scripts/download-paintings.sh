#!/bin/bash
# Run on your Mac to download all paintings via the Netlify proxy
# Usage: bash scripts/download-paintings.sh

DEST=~/Downloads/jeopardy-pwa-clean/public/paintings
PROXY=https://jeotrainer.netlify.app/.netlify/functions/imgproxy
mkdir -p "$DEST"

download() {
  local filename="$1"
  local query="$2"
  local out="$DEST/$filename.jpg"
  if [ -f "$out" ] && [ $(wc -c < "$out") -gt 1000 ]; then
    echo "✓ Already have $filename"
    return
  fi
  echo -n "Downloading $filename... "
  curl -sL "$PROXY?$query" -o "$out"
  local size=$(wc -c < "$out")
  if [ "$size" -gt 1000 ]; then
    echo "✓ ${size} bytes"
  else
    echo "✗ Failed (${size} bytes)"
    rm -f "$out"
  fi
}

download "mona_lisa" "title=Mona_Lisa"
download "the_last_supper" "title=The_Last_Supper_(Leonardo)"
download "creation_of_adam" "title=The_Creation_of_Adam"
download "school_of_athens" "title=The_School_of_Athens"
download "birth_of_venus" "title=The_Birth_of_Venus"
download "the_night_watch" "title=The_Night_Watch"
download "girl_pearl_earring" "title=Girl_with_a_Pearl_Earring"
download "third_of_may" "title=The_Third_of_May_1808"
download "liberty_leading" "title=Liberty_Leading_the_People"
download "fighting_temeraire" "title=The_Fighting_Temeraire"
download "water_lilies" "title=Water_Lilies_Monet"
download "impression_sunrise" "title=Impression,_Sunrise"
download "luncheon_boating" "title=Luncheon_of_the_Boating_Party"
download "dance_class" "title=The_Dance_Class_Degas"
download "sunday_grande_jatte" "title=A_Sunday_on_La_Grande_Jatte"
download "card_players" "title=The_Card_Players_Cezanne"
download "where_do_we_come_from" "title=Where_Do_We_Come_From_Gauguin"
download "starry_night" "title=The_Starry_Night"
download "sunflowers" "title=Sunflowers_Van_Gogh"
download "the_scream" "title=The_Scream"
download "the_kiss" "title=The_Kiss_(Klimt)"
download "guernica" "title=Guernica"
download "les_demoiselles" "title=Les_Demoiselles_d%27Avignon"
download "dance_matisse" "title=Dance_(Matisse)"
download "no_31" "title=One:_Number_31,_1950"
download "campbell_soup" "title=Campbell_Soup_Cans_Warhol"
download "american_gothic" "title=American_Gothic"
download "nighthawks" "title=Nighthawks"
download "arnolfini_portrait" "title=Arnolfini_Portrait"
download "garden_earthly_delights" "title=The_Garden_of_Earthly_Delights"
download "hunters_in_snow" "title=The_Hunters_in_the_Snow"
download "durer_self_portrait" "title=Albrecht_Dürer_self-portrait_1500"
download "descent_from_cross" "title=Descent_from_the_Cross_Rubens"
download "las_meninas" "title=Las_Meninas"
download "calling_saint_matthew" "title=The_Calling_of_Saint_Matthew"
download "death_of_marat" "title=The_Death_of_Marat"
download "wanderer_sea_fog" "title=Wanderer_above_the_Sea_of_Fog"
download "gulf_stream" "title=The_Gulf_Stream_(painting)"
download "gross_clinic" "title=The_Gross_Clinic"
download "the_cradle" "title=The_Cradle_(Morisot)"
download "childs_bath" "title=The_Child%27s_Bath"
download "egon_schiele" "title=Egon_Schiele"
download "composition_viii" "title=Composition_VIII_Kandinsky"
download "broadway_boogie" "title=Broadway_Boogie-Woogie"
download "jimson_weed" "title=Jimson_Weed_Georgia_OKeeffe"
download "man_at_crossroads" "title=Man_at_the_Crossroads_Rivera"

echo ""
echo "Done! Files in $DEST:"
ls -lh "$DEST"
