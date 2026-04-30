export const SAMPLE_BOARD = {
  round: 'Single Jeopardy',
  airDate: 'November 14, 2023',
  categories: [
    {
      name: 'WORLD CAPITALS',
      clues: [
        { value: 200,  answer: "This city on the Vistula River is Poland's capital.", question: 'What is Warsaw?', isDailyDouble: false },
        { value: 400,  answer: "The world's highest capital city, at over 11,500 feet.", question: 'What is Quito?', isDailyDouble: false },
        { value: 600,  answer: "This island nation's capital shares its name with the country.", question: 'What is Singapore?', isDailyDouble: false },
        { value: 800,  answer: 'Yamoussoukro is the official capital of this West African nation.', question: 'What is Ivory Coast?', isDailyDouble: true },
        { value: 1000, answer: 'Sri Jayawardenepura Kotte is the legislative capital of this nation.', question: 'What is Sri Lanka?', isDailyDouble: false },
      ],
    },
    {
      name: 'SCIENCE & NATURE',
      clues: [
        { value: 200,  answer: 'The powerhouse of the cell.', question: 'What is the mitochondria?', isDailyDouble: false },
        { value: 400,  answer: 'The only planet in our solar system less dense than water.', question: 'What is Saturn?', isDailyDouble: false },
        { value: 600,  answer: 'This element has the atomic symbol W.', question: 'What is Tungsten?', isDailyDouble: false },
        { value: 800,  answer: 'The only mammals capable of true flight.', question: 'What are bats?', isDailyDouble: false },
        { value: 1000, answer: 'The Coriolis effect causes cyclones to spin in this direction in the Northern Hemisphere.', question: 'What is counterclockwise?', isDailyDouble: false },
      ],
    },
    {
      name: 'AMERICAN HISTORY',
      clues: [
        { value: 200,  answer: 'The first 10 amendments to the U.S. Constitution.', question: 'What is the Bill of Rights?', isDailyDouble: false },
        { value: 400,  answer: 'This 1803 purchase doubled the size of the United States.', question: 'What is the Louisiana Purchase?', isDailyDouble: false },
        { value: 600,  answer: 'The only U.S. President to serve two non-consecutive terms.', question: 'Who is Grover Cleveland?', isDailyDouble: false },
        { value: 800,  answer: 'The Seneca Falls Convention of 1848 focused on this cause.', question: "What is women's suffrage?", isDailyDouble: true },
        { value: 1000, answer: 'This 1944 Supreme Court case upheld Japanese American internment.', question: 'What is Korematsu v. United States?', isDailyDouble: false },
      ],
    },
    {
      name: 'POP CULTURE',
      clues: [
        { value: 200,  answer: "The streaming service that produced 'Stranger Things'.", question: 'What is Netflix?', isDailyDouble: false },
        { value: 400,  answer: "Taylor Swift's record-breaking 2023–24 concert tour.", question: 'What is the Eras Tour?', isDailyDouble: false },
        { value: 600,  answer: 'This Pixar film features a young girl named Merida in Scotland.', question: 'What is Brave?', isDailyDouble: false },
        { value: 800,  answer: 'Oppenheimer director Christopher Nolan was born in this country.', question: 'What is the United Kingdom?', isDailyDouble: false },
        { value: 1000, answer: 'This HBO series based on a video game premiered in January 2023.', question: 'What is The Last of Us?', isDailyDouble: false },
      ],
    },
    {
      name: 'LITERARY CLASSICS',
      clues: [
        { value: 200,  answer: 'The whale in Moby-Dick.', question: 'What is the White Whale?', isDailyDouble: false },
        { value: 400,  answer: "George Orwell's dystopian novel set in Oceania.", question: 'What is 1984?', isDailyDouble: false },
        { value: 600,  answer: "The author of 'One Hundred Years of Solitude'.", question: 'Who is Gabriel García Márquez?', isDailyDouble: false },
        { value: 800,  answer: "This Charlotte Brontë novel contains the line 'Reader, I married him.'", question: 'What is Jane Eyre?', isDailyDouble: false },
        { value: 1000, answer: 'In this Dostoevsky novel, Raskolnikov murders a pawnbroker.', question: 'What is Crime and Punishment?', isDailyDouble: false },
      ],
    },
    {
      name: 'SPORTS',
      clues: [
        { value: 200,  answer: 'Number of players per team on a basketball court.', question: 'What is 5?', isDailyDouble: false },
        { value: 400,  answer: 'Tiger Woods plays this sport.', question: 'What is golf?', isDailyDouble: false },
        { value: 600,  answer: 'The city that hosted the 2022 FIFA World Cup.', question: 'What is Doha (Qatar)?', isDailyDouble: false },
        { value: 800,  answer: "This Boston Red Sox slugger was nicknamed 'Big Papi'.", question: 'Who is David Ortiz?', isDailyDouble: false },
        { value: 1000, answer: 'The tennis term for a score of 40-40.', question: 'What is deuce?', isDailyDouble: false },
      ],
    },
  ],
}
