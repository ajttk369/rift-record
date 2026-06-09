function compactStaticData(staticData, matches, masteries) {
  const championIds = new Set(masteries.map((mastery) => String(mastery.championId)));
  const runeIds = new Set();
  const styleIds = new Set();

  for (const match of matches) {
    for (const participant of match.info.participants) {
      if (participant.championId) {
        championIds.add(String(participant.championId));
      }

      for (const style of participant.perks?.styles || []) {
        styleIds.add(String(style.style));
        for (const selection of style.selections || []) {
          runeIds.add(String(selection.perk));
        }
      }
    }
  }

  return {
    champions: Object.fromEntries(
      [...championIds]
        .filter((id) => staticData.champions[id])
        .map((id) => [id, staticData.champions[id]])
    ),
    runes: Object.fromEntries(
      [...runeIds]
        .filter((id) => staticData.runes[id])
        .map((id) => [id, staticData.runes[id]])
    ),
    runeStyles: Object.fromEntries(
      [...styleIds]
        .filter((id) => staticData.runeStyles[id])
        .map((id) => [id, staticData.runeStyles[id]])
    )
  };
}
