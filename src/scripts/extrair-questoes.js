const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3001;

// Configuração de upload de imagens
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../assets/images');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../../public')));

// ==================== PARSER INTELIGENTE ====================

class ParserQuestoes {
  /**
   * Extrai questões de texto bruto do PDF
   */
  static extrair(textoBruto, metadados) {
    // Normalizar texto
    const texto = textoBruto
      .replace(/QUESTãO/gi, 'QUESTAO')
      .replace(/Quest\s*ão/gi, 'QUESTAO')
      .trim();

    // Dividir em blocos de questões
    const blocos = texto.split(/QUESTAO\s+(\d+)/i).slice(1);
    
    const questoes = [];
    
    for (let i = 0; i < blocos.length; i += 2) {
      const numero = parseInt(blocos[i]);
      const conteudo = blocos[i + 1];
      
      if (conteudo) {
        const questao = this.parseQuestao(numero, conteudo, metadados);
        questoes.push(questao);
      }
    }
    
    return questoes;
  }

  /**
   * Faz parse de uma questão individual
   */
  static parseQuestao(numero, conteudo, metadados) {
    // Separar enunciado das alternativas
    const partes = conteudo.split(/^([A-E])\s+/m);
    
    let enunciado = partes[0].trim();
    const alternativas = [];
    
    // Extrair alternativas
    for (let i = 1; i < partes.length; i += 2) {
      const letra = partes[i];
      const texto = partes[i + 1]?.trim() || '';
      
      if (letra && texto) {
        alternativas.push({
          letra: letra,
          texto: texto.replace(/\n/g, ' ').trim()
        });
      }
    }
    
    // Identificar se há texto de apoio (poema, artigo, etc)
    const temTextoApoio = this.detectarTextoApoio(enunciado);
    let textoApoio = null;
    
    if (temTextoApoio) {
      const divisao = this.separarTextoApoio(enunciado);
      textoApoio = divisao.textoApoio;
      enunciado = divisao.enunciado;
    }
    
    return {
      id: `${metadados.codigoProva}-q${numero.toString().padStart(2, '0')}`,
      numero: numero,
      prova: metadados.nomeProva,
      ano: metadados.ano,
      disciplina: metadados.disciplina,
      enunciado: this.limparTexto(enunciado),
      textoApoio: textoApoio ? this.limparTexto(textoApoio) : null,
      alternativas: alternativas,
      imagem: null, // Será adicionada depois
      respostaCorreta: null,
      fonte: metadados.fonte
    };
  }

  /**
   * Detecta se há texto de apoio (poema, notícia, etc)
   */
  static detectarTextoApoio(texto) {
    const indicadores = [
      /Disponível em:/i,
      /Acesso em:/i,
      /\(fragmento\)/i,
      /\(adaptado\)/i
    ];
    
    return indicadores.some(regex => regex.test(texto));
  }

  /**
   * Separa texto de apoio do enunciado
   */
  static separarTextoApoio(texto) {
    // Procurar pela última fonte/referência
    const regexFonte = /(.*?)((?:Disponível em:|ANGELOU|CISNEROS|ŽOLDOŠ).*?)$/s;
    const match = texto.match(regexFonte);
    
    if (match) {
      return {
        textoApoio: match[1].trim(),
        enunciado: '' // O enunciado geralmente vem após o texto de apoio
      };
    }
    
    // Se não encontrar, procurar por padrões de pergunta
    const regexPergunta = /(.*?)([A-Z].*?[?.])\s*$/s;
    const matchPergunta = texto.match(regexPergunta);
    
    if (matchPergunta) {
      return {
        textoApoio: matchPergunta[1].trim(),
        enunciado: matchPergunta[2].trim()
      };
    }
    
    return {
      textoApoio: texto,
      enunciado: ''
    };
  }

  /**
   * Limpa e formata texto
   */
  static limparTexto(texto) {
    return texto
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim();
  }
}

// ==================== ROTAS DA API ====================

// Rota para extrair questões
app.post('/api/extrair', (req, res) => {
  try {
    const { textoBruto, metadados } = req.body;
    
    if (!textoBruto || !metadados) {
      return res.status(400).json({ 
        erro: 'Texto e metadados são obrigatórios' 
      });
    }
    
    const questoes = ParserQuestoes.extrair(textoBruto, metadados);
    
    res.json({
      sucesso: true,
      total: questoes.length,
      questoes: questoes
    });
  } catch (erro) {
    res.status(500).json({ 
      erro: erro.message 
    });
  }
});

// Rota para fazer upload de imagem
app.post('/api/upload-imagem', upload.single('imagem'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ erro: 'Nenhuma imagem enviada' });
    }
    
    res.json({
      sucesso: true,
      nomeArquivo: req.file.filename,
      caminho: `/images/${req.file.filename}`
    });
  } catch (erro) {
    res.status(500).json({ erro: erro.message });
  }
});

// Rota para salvar questões finalizadas
app.post('/api/salvar-questoes', (req, res) => {
  try {
    const { questoes, nomeArquivo } = req.body;
    
    const dirProcessed = path.join(__dirname, '../data/processed');
    if (!fs.existsSync(dirProcessed)) {
      fs.mkdirSync(dirProcessed, { recursive: true });
    }
    
    const caminhoArquivo = path.join(dirProcessed, nomeArquivo);
    
    fs.writeFileSync(
      caminhoArquivo,
      JSON.stringify(questoes, null, 2),
      'utf-8'
    );
    
    res.json({
      sucesso: true,
      mensagem: `${questoes.length} questões salvas com sucesso!`,
      arquivo: nomeArquivo
    });
  } catch (erro) {
    res.status(500).json({ erro: erro.message });
  }
});

// Rota para listar questões salvas
app.get('/api/questoes', (req, res) => {
  try {
    const dirProcessed = path.join(__dirname, '../data/processed');
    
    if (!fs.existsSync(dirProcessed)) {
      return res.json({ arquivos: [] });
    }
    
    const arquivos = fs.readdirSync(dirProcessed)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const conteudo = fs.readFileSync(path.join(dirProcessed, f), 'utf-8');
        const dados = JSON.parse(conteudo);
        
        return {
          nome: f,
          total: dados.length,
          prova: dados[0]?.prova || 'Desconhecido'
        };
      });
    
    res.json({ arquivos });
  } catch (erro) {
    res.status(500).json({ erro: erro.message });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`\n🚀 Servidor de extração rodando em http://localhost:${PORT}`);
  console.log(`\n📝 Acesse o navegador para começar a extrair questões!\n`);
});

module.exports = app;