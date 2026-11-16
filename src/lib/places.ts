/**
 * Reconhece, pelo TEXTO do endereço, em que "região" fica uma origem ou um destino.
 * Regras fixas (sem IA, sem internet, nada é enviado para fora): uma lista de cidades agrupadas em regiões
 * (ex.: Joinville, Blumenau e Pomerode = "Norte de SC") e, quando a cidade não é conhecida, o estado.
 *
 * Por que região e não cidade: para "casar" mudanças o que importa é o caminhão passar pelo mesmo lado
 * do país. BH → Joinville e BH → Blumenau são a mesma viagem.
 */

export interface Place {
  id: string;
  /** Nome para mostrar no mapa e nas listas. */
  label: string;
  /** Posição aproximada (centro da região). */
  lon: number;
  lat: number;
  uf: string;
}

/** Cidade "!" no fim = nome que existe em vários estados: só vale se o texto também citar o estado. */
type Cluster = [id: string, label: string, lon: number, lat: number, uf: string, cities: string];

const CLUSTERS: Cluster[] = [
  // ───────── Minas Gerais ─────────
  ['bh', 'BH e Grande BH', -43.94, -19.92, 'MG', 'Belo Horizonte, BH, BHZ, Contagem, Betim, Nova Lima, Sabará, Santa Luzia, Ribeirão das Neves, Vespasiano, Ibirité, Lagoa Santa, Sarzedo, São Joaquim de Bicas, Brumadinho, Igarapé, Esmeraldas, Mateus Leme, Pedro Leopoldo, Matozinhos, Confins, Caeté, Raposos, Rio Acima, Juatuba, Mário Campos, São José da Lapa, Capim Branco, Jaboticatubas, Florestal, Buritis, Savassi, Pampulha, Barreiro, Venda Nova, Sagrada Família, Santo Agostinho, Funcionários, Mangabeiras, Belvedere, Cidade Nova, Padre Eustáquio, Santa Efigênia, Santa Tereza, Gutierrez, Floresta, Coração Eucarístico'],
  ['mg-sete-lagoas', 'Sete Lagoas', -44.25, -19.47, 'MG', 'Sete Lagoas, Paraopeba, Cordisburgo, Prudente de Morais'],
  ['mg-curvelo', 'Curvelo', -44.43, -18.76, 'MG', 'Curvelo, Corinto, Felixlândia, Três Marias'],
  ['mg-norte', 'Norte de MG (Montes Claros)', -43.86, -16.73, 'MG', 'Montes Claros, Janaúba, Pirapora, Bocaiúva, Januária, Várzea da Palma, Juvenília, Salinas, Brasília de Minas, São Francisco, Manga, Francisco Sá, Jequitaí, Buritizeiro'],
  ['mg-oeste', 'Divinópolis e Centro-Oeste de MG', -44.88, -20.14, 'MG', 'Divinópolis, Itaúna, Nova Serrana, Pará de Minas, Formiga, Bom Despacho, Cláudio, Oliveira, Carmo do Cajuru, Santo Antônio do Monte, Lagoa da Prata, Arcos, Pitangui, Campo Belo, Piumhi, Itapecerica, Itaguara'],
  ['mg-alto-paranaiba', 'Patos de Minas / Alto Paranaíba', -46.52, -18.58, 'MG', 'Patos de Minas, Patrocínio, Araxá, Carmo do Paranaíba, Lagoa Formosa'],
  ['mg-triangulo', 'Triângulo Mineiro (Uberlândia)', -48.28, -18.92, 'MG', 'Uberlândia, Uberaba, Araguari, Ituiutaba, Frutal, Monte Carmelo, Prata, Sacramento'],
  ['mg-noroeste', 'Noroeste de MG (Paracatu / Unaí)', -46.87, -17.22, 'MG', 'Paracatu, Unaí, João Pinheiro, Vazante'],
  ['mg-vale-do-aco', 'Vale do Aço / Itabira', -42.9, -19.55, 'MG', 'Ipatinga, Coronel Fabriciano, Timóteo, Itabira, João Monlevade, Santa Bárbara, Bom Jesus do Amparo, Nova Era, Rio Piracicaba'],
  ['mg-leste', 'Governador Valadares / Leste de MG', -41.95, -18.85, 'MG', 'Governador Valadares, Caratinga, Resplendor, Aimorés, Guanhães, Inhapim'],
  ['mg-zona-da-mata', 'Juiz de Fora / Zona da Mata', -43.35, -21.76, 'MG', 'Juiz de Fora, Muriaé, Ubá, Viçosa, Cataguases, Ponte Nova, Manhuaçu, Leopoldina, Visconde do Rio Branco, Carangola, Matipó, Raul Soares'],
  ['mg-nordeste', 'Teófilo Otoni / Nordeste de MG', -41.5, -17.86, 'MG', 'Teófilo Otoni, Nanuque, Pedra Azul, Almenara, Diamantina, Itaobim, Capelinha, Araçuaí, Águas Formosas, Itambacuri, Carlos Chagas, Medina, Salto da Divisa'],
  ['mg-quadrilatero', 'Ouro Preto / Lafaiete / Barbacena', -43.8, -20.55, 'MG', 'Ouro Preto, Mariana, Itabirito, Congonhas, Conselheiro Lafaiete, Ouro Branco, Barbacena, São João del Rei, Belo Vale, Moeda, Tiradentes, Carandaí'],
  ['mg-sul', 'Sul de MG (Pouso Alegre / Varginha)', -45.5, -22.0, 'MG', 'Pouso Alegre, Poços de Caldas, Varginha, Lavras, Três Corações, Itajubá, Conceição do Rio Verde, São Sebastião do Paraíso, Alfenas, Passos, Guaxupé, Extrema, Machado, Três Pontas, Santa Rita do Sapucaí, Caxambu, São Lourenço'],

  // ───────── São Paulo ─────────
  ['sp-capital', 'São Paulo (capital e Grande SP)', -46.63, -23.55, 'SP', 'São Paulo, Guarulhos, Osasco, Santo André, São Bernardo do Campo, São Caetano do Sul, Barueri, Mogi das Cruzes, Diadema, Carapicuíba, Taboão da Serra, Cotia, Santana de Parnaíba, Itaquaquecetuba, Suzano, Embu das Artes, Mauá, Poá, Jandira, Itapevi, Arujá, Francisco Morato, Franco da Rocha, Caieiras, Cajamar, Ribeirão Pires, Itapecerica da Serra'],
  ['sp-baixada', 'Baixada Santista', -46.33, -23.96, 'SP', 'Santos, Guarujá, Praia Grande, São Vicente, Cubatão, Bertioga, Mongaguá, Itanhaém, Peruíbe'],
  ['sp-campinas', 'Campinas e região', -47.06, -22.9, 'SP', "Campinas, Indaiatuba, Americana, Limeira, Piracicaba, Jundiaí, Louveira, Valinhos, Vinhedo, Sumaré, Hortolândia, Bragança Paulista, Atibaia, Itatiba, Paulínia, Nova Odessa, Santa Bárbara d'Oeste, São João da Boa Vista, Mogi Guaçu, Mogi Mirim, Rio Claro, Cosmópolis, Amparo, Itapira"],
  ['sp-sorocaba', 'Sorocaba / Botucatu', -47.7, -23.2, 'SP', 'Sorocaba, Botucatu, Itu, Salto, Itapetininga, Tatuí, Votorantim, Avaré, Boituva, Porto Feliz'],
  ['sp-vale', 'Vale do Paraíba / Litoral Norte', -45.89, -23.22, 'SP', 'São José dos Campos, Taubaté, Jacareí, Pindamonhangaba, Guaratinguetá, Caraguatatuba, Ubatuba, São Sebastião, Ilhabela, Lorena, Campos do Jordão'],
  ['sp-ribeirao', 'Ribeirão Preto / Araraquara', -48.0, -21.7, 'SP', 'Ribeirão Preto, Araraquara, São Carlos, Franca, Sertãozinho, Jaboticabal, Matão, Barretos, Batatais, Bebedouro, Pirassununga, Araras, Leme, Jaú'],
  ['sp-oeste', 'Bauru / Rio Preto / Oeste de SP', -50.0, -21.8, 'SP', 'Bauru, São José do Rio Preto, Marília, Presidente Prudente, Araçatuba, Assis, Ourinhos, Lins, Votuporanga, Birigui, Catanduva, Fernandópolis, Tupã'],

  // ───────── Rio de Janeiro / Espírito Santo ─────────
  ['rj-capital', 'Rio de Janeiro (capital e Grande Rio)', -43.17, -22.91, 'RJ', 'Rio de Janeiro, Niterói, Duque de Caxias, Nova Iguaçu, São Gonçalo, Belford Roxo, São João de Meriti, Itaboraí, Maricá, Queimados'],
  ['rj-serra', 'Região Serrana do RJ', -42.9, -22.4, 'RJ', 'Petrópolis, Nova Friburgo, Teresópolis'],
  ['rj-norte', 'Macaé / Cabo Frio / Norte do RJ', -41.8, -22.2, 'RJ', 'Macaé, Campos dos Goytacazes, Cabo Frio, São Pedro da Aldeia, Arraial do Cabo, Búzios, Rio das Ostras, Araruama, Saquarema'],
  ['rj-sul', 'Volta Redonda / Sul do RJ', -44.1, -22.52, 'RJ', 'Volta Redonda, Barra Mansa, Resende, Angra dos Reis, Paraty'],
  ['es-vitoria', 'Grande Vitória (ES)', -40.34, -20.32, 'ES', 'Vitória, Vila Velha, Serra!, Cariacica, Guarapari, Viana'],
  ['es-norte', 'Norte do ES (Linhares / Colatina)', -40.5, -19.2, 'ES', 'Colatina, Linhares, Baixo Guandu, Aracruz, São Mateus!'],
  ['es-sul', 'Sul do ES (Cachoeiro)', -41.1, -20.85, 'ES', 'Cachoeiro de Itapemirim, Guaçuí, Castelo, Alegre'],

  // ───────── Sul ─────────
  ['pr-curitiba', 'Curitiba e região', -49.27, -25.43, 'PR', 'Curitiba, São José dos Pinhais, Araucária, Colombo, Pinhais, Fazenda Rio Grande, Campo Largo'],
  ['pr-litoral', 'Litoral do Paraná (Paranaguá)', -48.5, -25.52, 'PR', 'Paranaguá, Matinhos, Guaratuba, Pontal do Paraná'],
  ['pr-campos-gerais', 'Ponta Grossa / Guarapuava', -50.8, -25.4, 'PR', 'Ponta Grossa, Guarapuava, São Mateus do Sul, Irati, União da Vitória, Castro, Telêmaco Borba'],
  ['pr-norte', 'Londrina / Maringá', -51.3, -23.4, 'PR', 'Londrina, Maringá, Apucarana, Arapongas, Cambé, Paranavaí'],
  ['pr-oeste', 'Cascavel / Foz do Iguaçu', -53.5, -25.0, 'PR', 'Cascavel, Foz do Iguaçu, Toledo, Medianeira'],
  ['sc-norte', 'Norte de SC (Joinville / Blumenau)', -48.9, -26.8, 'SC', 'Joinville, Blumenau, Pomerode, Itajaí, Balneário Camboriú, Camboriú, Jaraguá do Sul, Brusque, São João Batista, Gaspar, Navegantes, Itapema, Indaial, Timbó, São Francisco do Sul, Penha, Piçarras, Tijucas'],
  ['sc-floripa', 'Florianópolis e região', -48.55, -27.6, 'SC', 'Florianópolis, Floripa, São José!, Palhoça, Biguaçu, Santo Amaro da Imperatriz, Governador Celso Ramos'],
  ['sc-sul', 'Sul de SC (Criciúma / Tubarão)', -49.37, -28.68, 'SC', 'Criciúma, Tubarão, Laguna, Imbituba, Içara, Araranguá, Garopaba'],
  ['sc-oeste', 'Oeste de SC (Chapecó / Lages)', -51.5, -27.3, 'SC', 'Chapecó, Concórdia, Xanxerê, Joaçaba, Lages'],
  ['rs-poa', 'Porto Alegre e região', -51.23, -30.03, 'RS', 'Porto Alegre, Canoas, Gravataí, Novo Hamburgo, São Leopoldo, Viamão, Cachoeirinha, Alvorada, Sapucaia do Sul, Esteio, Taquara'],
  ['rs-serra', 'Serra Gaúcha (Caxias do Sul)', -51.18, -29.17, 'RS', 'Caxias do Sul, Bento Gonçalves, Gramado, Canela, Farroupilha, Garibaldi, Nova Petrópolis, Flores da Cunha'],
  ['rs-sul', 'Pelotas / Rio Grande', -52.34, -31.77, 'RS', 'Pelotas, Rio Grande, Camaquã'],
  ['rs-interior', 'Interior do RS (Santa Maria / Passo Fundo)', -53.8, -29.7, 'RS', 'Santa Maria!, Passo Fundo, Santa Cruz do Sul, Uruguaiana, Santana do Livramento, Ijuí, Santo Ângelo, Lajeado'],

  // ───────── Centro-Oeste ─────────
  ['df', 'Brasília (DF e entorno)', -47.88, -15.79, 'DF', 'Brasília, Taguatinga, Ceilândia, Samambaia, Gama, Sobradinho, Planaltina, Águas Claras, Lago Sul, Lago Norte, Asa Sul, Asa Norte, Valparaíso de Goiás, Luziânia, Águas Lindas, Cidade Ocidental, Distrito Federal'],
  ['go-goiania', 'Goiânia e região', -49.25, -16.68, 'GO', 'Goiânia, Aparecida de Goiânia, Anápolis, Senador Canedo, Trindade!, Goianira, Inhumas'],
  ['go-sul', 'Sul de Goiás (Rio Verde / Itumbiara)', -50.9, -17.8, 'GO', 'Rio Verde, Catalão, Itumbiara, Jataí, Caldas Novas, Morrinhos'],
  ['mt-cuiaba', 'Cuiabá / Mato Grosso', -56.1, -15.6, 'MT', 'Cuiabá, Várzea Grande, Rondonópolis, Sinop, Sorriso, Lucas do Rio Verde, Tangará da Serra'],
  ['ms-campo-grande', 'Campo Grande (MS)', -54.62, -20.47, 'MS', 'Campo Grande!, Aquidauana, Sidrolândia, Três Lagoas'],
  ['ms-corumba', 'Corumbá (MS)', -57.65, -19.0, 'MS', 'Corumbá, Ladário'],
  ['ms-sul', 'Sul de MS (Dourados / Naviraí)', -54.4, -22.5, 'MS', 'Dourados, Naviraí, Ponta Porã, Amambai, Maracaju'],

  // ───────── Nordeste ─────────
  ['ba-salvador', 'Salvador e região', -38.51, -12.97, 'BA', 'Salvador, Lauro de Freitas, Camaçari, Simões Filho, Feira de Santana, Alagoinhas'],
  ['ba-sul', 'Sul da Bahia (Teixeira de Freitas / Porto Seguro)', -39.4, -16.5, 'BA', 'Teixeira de Freitas, Porto Seguro, Eunápolis, Itabuna, Ilhéus, Caravelas, Alcobaça, Mucuri, Itamaraju'],
  ['ba-sudoeste', 'Vitória da Conquista / Jequié', -40.5, -14.2, 'BA', 'Vitória da Conquista, Jequié, Brumado, Guanambi, Itapetinga'],
  ['ba-oeste', 'Oeste da Bahia (Barreiras / Juazeiro)', -44.0, -11.5, 'BA', 'Barreiras, Luís Eduardo Magalhães, Juazeiro, Paulo Afonso'],
  ['se', 'Sergipe (Aracaju)', -37.07, -10.91, 'SE', 'Aracaju, Nossa Senhora do Socorro, Lagarto, Itabaiana'],
  ['al', 'Alagoas (Maceió)', -35.73, -9.67, 'AL', 'Maceió, Arapiraca, Rio Largo'],
  ['pe-recife', 'Recife e região', -34.88, -8.05, 'PE', 'Recife, Olinda, Jaboatão dos Guararapes, Paulista, Cabo de Santo Agostinho, Camaragibe'],
  ['pe-interior', 'Interior de PE (Caruaru / Petrolina)', -37.0, -8.5, 'PE', 'Caruaru, Petrolina, Garanhuns, Gravatá, Vitória de Santo Antão'],
  ['pb', 'Paraíba', -35.3, -7.15, 'PB', 'João Pessoa, Campina Grande, Santa Rita, Patos'],
  ['rn', 'Rio Grande do Norte (Natal)', -35.21, -5.79, 'RN', 'Natal, Mossoró, Parnamirim, Ceará-Mirim, Macaíba'],
  ['ce', 'Ceará (Fortaleza)', -38.53, -3.73, 'CE', 'Fortaleza, Caucaia, Maracanaú, Eusébio, Aquiraz, Sobral, Juazeiro do Norte, Crato'],
  ['pi', 'Piauí', -42.8, -5.09, 'PI', 'Teresina, Parnaíba, Picos, Floriano'],
  ['ma', 'Maranhão', -44.3, -2.53, 'MA', 'São Luís, Imperatriz, Dom Pedro, Caxias!, Timon, Codó, Balsas'],

  // ───────── Norte ─────────
  ['pa-belem', 'Belém (PA)', -48.5, -1.45, 'PA', 'Belém, Ananindeua, Castanhal, Santarém'],
  ['pa-carajas', 'Parauapebas / Carajás (PA)', -49.9, -6.07, 'PA', 'Parauapebas, Pauapebas, Marabá, Canaã dos Carajás, Carajás, Curionópolis, Xinguara, Redenção'],
  ['am', 'Amazonas (Manaus)', -60.02, -3.12, 'AM', 'Manaus, Parintins, Itacoatiara'],
  ['ro', 'Rondônia', -63.9, -8.76, 'RO', 'Porto Velho, Ji-Paraná, Ariquemes, Vilhena'],
  ['ac', 'Acre', -67.81, -9.97, 'AC', 'Rio Branco!, Cruzeiro do Sul'],
  ['rr', 'Roraima', -60.67, 2.82, 'RR', 'Boa Vista!'],
  ['ap', 'Amapá', -51.07, 0.03, 'AP', 'Macapá'],
  ['to', 'Tocantins', -48.33, -10.18, 'TO', 'Palmas!, Araguaína, Gurupi, Porto Nacional'],
];

/** Quando a cidade não é conhecida mas o texto cita o estado: usamos este ponto (rótulo = o próprio estado). */
const STATE_FALLBACK: Array<[uf: string, id: string, label: string, lon: number, lat: number]> = [
  ['MG', 'mg-outras', 'Interior de MG', -44.9, -18.3],
  ['SP', 'sp-outras', 'Interior de SP', -48.3, -22.4],
  ['RJ', 'rj-outras', 'Interior do RJ', -42.6, -22.0],
  ['ES', 'es-outras', 'Espírito Santo', -40.6, -19.7],
  ['PR', 'pr-outras', 'Paraná', -51.5, -24.8],
  ['SC', 'sc-outras', 'Santa Catarina', -50.5, -27.2],
  ['RS', 'rs-outras', 'Rio Grande do Sul', -53.0, -29.6],
  ['DF', 'df', '', 0, 0], // usa o próprio ponto de Brasília
  ['GO', 'go-outras', 'Goiás', -49.5, -15.9],
  ['MT', 'mt-outras', 'Mato Grosso', -55.5, -13.0],
  ['MS', 'ms-outras', 'Mato Grosso do Sul', -54.8, -20.9],
  ['BA', 'ba-outras', 'Bahia', -41.7, -12.9],
  ['PE', 'pe-outras', 'Pernambuco', -36.5, -8.3],
  ['PA', 'pa-outras', 'Pará', -52.0, -4.0],
  ['SE', 'se', '', 0, 0],
  ['AL', 'al', '', 0, 0],
  ['PB', 'pb', '', 0, 0],
  ['RN', 'rn', '', 0, 0],
  ['CE', 'ce', '', 0, 0],
  ['PI', 'pi', '', 0, 0],
  ['MA', 'ma', '', 0, 0],
  ['AM', 'am', '', 0, 0],
  ['RO', 'ro', '', 0, 0],
  ['AC', 'ac', '', 0, 0],
  ['RR', 'rr', '', 0, 0],
  ['AP', 'ap', '', 0, 0],
  ['TO', 'to', '', 0, 0],
];

/** Nome do estado por extenso → sigla (só vale quando não achamos nenhuma cidade). */
const STATE_NAMES: Array<[name: string, uf: string]> = [
  ['minas gerais', 'MG'], ['espirito santo', 'ES'], ['santa catarina', 'SC'], ['rio grande do sul', 'RS'],
  ['rio grande do norte', 'RN'], ['mato grosso do sul', 'MS'], ['mato grosso', 'MT'], ['distrito federal', 'DF'],
  ['rio de janeiro', 'RJ'], ['sao paulo', 'SP'], ['parana', 'PR'], ['bahia', 'BA'], ['goias', 'GO'],
  ['pernambuco', 'PE'], ['ceara', 'CE'], ['maranhao', 'MA'], ['amazonas', 'AM'], ['tocantins', 'TO'],
  ['paraiba', 'PB'], ['piaui', 'PI'], ['sergipe', 'SE'], ['alagoas', 'AL'], ['acre', 'AC'], ['rondonia', 'RO'],
  ['roraima', 'RR'], ['amapa', 'AP'],
];

const UF_CODES = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);

/** Palavras que, logo antes de um nome de cidade, mostram que é rua/bairro ("Rua São Paulo", "Bairro Ouro Preto"). */
const STREET_WORDS = new Set([
  'rua', 'r', 'avenida', 'av', 'travessa', 'tv', 'alameda', 'praca', 'pca', 'rodovia', 'estrada', 'bairro',
  'vila', 'jardim', 'residencial', 'condominio', 'loteamento', 'parque', 'conjunto', 'edificio', 'ed',
]);

const normalize = (s: string) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// ── Tabelas montadas uma vez ──
export const PLACES: Record<string, Place> = {};
interface Entry {
  phrase: string;
  placeId: string;
  needsUf: boolean;
  uf: string;
}
const ENTRIES: Entry[] = [];

for (const [id, label, lon, lat, uf, cities] of CLUSTERS) {
  PLACES[id] = { id, label, lon, lat, uf };
  for (const raw of cities.split(',')) {
    const name = raw.trim();
    if (!name) continue;
    const needsUf = name.endsWith('!');
    ENTRIES.push({ phrase: normalize(needsUf ? name.slice(0, -1) : name), placeId: id, needsUf, uf });
  }
}

const STATE_PLACE: Record<string, string> = {};
for (const [uf, id, label, lon, lat] of STATE_FALLBACK) {
  STATE_PLACE[uf] = id;
  if (!PLACES[id]) PLACES[id] = { id, label, lon, lat, uf };
}

/** Siglas em MAIÚSCULAS no texto original ("Londrina - PR", "Paracatu/MG"). Ignora "AP 302" (apartamento). */
function ufCodes(original: string): Set<string> {
  const found = new Set<string>();
  const re = /(?<![A-Za-z0-9])([A-Z]{2})(?![A-Za-z])\s*(?=$|[,;)\]/.\-–(])/g;
  for (const m of original.matchAll(re)) if (UF_CODES.has(m[1])) found.add(m[1]);
  return found;
}

interface Hit {
  start: number;
  end: number;
  placeId: string;
  needsUf: boolean;
  uf: string;
}

export interface Resolved {
  place: Place;
  /** true = achamos a cidade; false = só o estado (cidade não conhecida). */
  fromCity: boolean;
}

/**
 * Descobre a região de um endereço. Devolve null quando não dá para saber.
 * 1) Cidades conhecidas (vale a ÚLTIMA citada, porque o endereço termina na cidade: "Niterói, Betim - MG" é Betim).
 *    Nome logo depois de "rua/bairro/vila…" é ignorado.
 * 2) Sem cidade: a sigla do estado ("Cidade X - MG") ou o nome do estado.
 */
export function resolvePlace(text: string): Resolved | null {
  const original = text ?? '';
  const norm = normalize(original);
  if (!norm) return null;
  const words = norm.split(' ');
  const codes = ufCodes(original);

  // Procura cada cidade da lista como sequência de palavras inteiras.
  const hits: Hit[] = [];
  for (const entry of ENTRIES) {
    const phrase = entry.phrase.split(' ');
    for (let i = 0; i + phrase.length <= words.length; i++) {
      if (!phrase.every((w, k) => words[i + k] === w)) continue;
      if (i > 0 && STREET_WORDS.has(words[i - 1])) continue;
      hits.push({ start: i, end: i + phrase.length, placeId: entry.placeId, needsUf: entry.needsUf, uf: entry.uf });
    }
  }

  // Estados citados por extenso (só para conferir cidades ambíguas e para o plano B).
  const named = new Set<string>();
  for (const [name, uf] of STATE_NAMES) {
    const parts = name.split(' ');
    for (let i = 0; i + parts.length <= words.length; i++) {
      if (parts.every((w, k) => words[i + k] === w) && !(i > 0 && STREET_WORDS.has(words[i - 1]))) named.add(uf);
    }
  }
  const stateMentions = new Set([...codes, ...named]);

  // Cidade que existe em vários estados só vale se o texto cita o estado dela.
  const valid = hits.filter(h => !h.needsUf || stateMentions.has(h.uf));

  // Descarta frase que está dentro de outra maior ("vitoria" dentro de "vitoria da conquista").
  const kept = valid.filter(h => !valid.some(o => o !== h && o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start));
  if (kept.length > 0) {
    const last = kept.reduce((a, b) => (b.start > a.start || (b.start === a.start && b.end - b.start > a.end - a.start) ? b : a));
    return { place: PLACES[last.placeId], fromCity: true };
  }

  // Plano B: o estado. Prefere a sigla escrita em maiúsculas.
  const uf = [...codes][0] ?? [...named][0];
  if (uf && STATE_PLACE[uf]) return { place: PLACES[STATE_PLACE[uf]], fromCity: false };
  return null;
}

/** Nome curto para escrever em cima do mapa (a lista usa o nome completo). */
export function shortLabel(place: Pick<Place, 'id' | 'label'>): string {
  if (place.id === 'bh') return 'BH';
  return place.label.split(/ \(| \/ | e /)[0];
}
