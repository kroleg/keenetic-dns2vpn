declare module 'dns-packet' {
  interface DnsAnswer {
    type: string;
    name: string;
    ttl: number;
    data: string | string[] | Buffer;
    class?: string;
    flush?: boolean;
  }

  interface DnsQuestion {
    type: string;
    name: string;
    class?: string;
  }

  interface DnsPacket {
    type?: string;
    id?: number;
    flags?: number;
    questions: DnsQuestion[];
    answers: DnsAnswer[];
    authorities?: DnsAnswer[];
    additionals?: DnsAnswer[];
  }

  function decode(buf: Buffer): DnsPacket;
  function encode(packet: DnsPacket): Buffer;

  export { decode, encode, DnsPacket, DnsQuestion, DnsAnswer };
  export default { decode, encode };
}
