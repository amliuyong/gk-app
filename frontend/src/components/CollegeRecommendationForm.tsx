'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Form, Input, Button, Select, Card, Typography, Row, Col, message } from 'antd';
import { modelOptions } from '../config/models';
import { WS_URL } from '../config';
import ReactMarkdown from 'react-markdown';

const { Title, Paragraph } = Typography;
const { Option } = Select;

// Interface for message chunks
interface MessageChunk {
  content: string;
  sequence: number;
}

const CollegeRecommendationForm = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [responseMessage, setResponseMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [connectionAttempted, setConnectionAttempted] = useState(false);
  
  // Message buffer for ordering
  const messageBufferRef = useRef<MessageChunk[]>([]);
  const lastProcessedSequenceRef = useRef<number>(-1);
  
  // Function to process buffered messages in order
  const processMessageBuffer = () => {
    // Sort the buffer by sequence number
    const sortedBuffer = [...messageBufferRef.current].sort((a, b) => a.sequence - b.sequence);
    
    // Find consecutive messages starting from the last processed sequence
    let newContent = '';
    let lastProcessed = lastProcessedSequenceRef.current;
    
    // Process messages in sequence order
    for (const chunk of sortedBuffer) {
      if (chunk.sequence === lastProcessed + 1) {
        newContent += chunk.content;
        lastProcessed = chunk.sequence;
      }
    }
    
    // If we processed any new messages
    if (newContent) {
      setResponseMessage(prev => prev + newContent);
      lastProcessedSequenceRef.current = lastProcessed;
      
      // Remove processed messages from the buffer
      messageBufferRef.current = messageBufferRef.current.filter(
        chunk => chunk.sequence > lastProcessedSequenceRef.current
      );
    }
  };

  // Initialize WebSocket connection
  useEffect(() => {
    // Create WebSocket connection
    socketRef.current = new WebSocket(WS_URL);
    
    // Set a timeout to mark connection as attempted after 2 seconds
    const connectionTimeout = setTimeout(() => {
      setConnectionAttempted(true);
    }, 2000);
    
    // Connection opened
    socketRef.current.addEventListener('open', () => {
      console.log('WebSocket Connected');
      setSocketConnected(true);
      setConnectionAttempted(true);
      clearTimeout(connectionTimeout);
    });
    
    // Listen for messages
    socketRef.current.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      console.log('Message from server:', data);
      
      if (data.type === 'error') {
        setError(data.content || '发生错误，请重试');
        setLoading(false);
      } else if (data.type === 'response' && !data.done) {
        // Add message to buffer
        if (data.content && data.sequence !== undefined) {
          messageBufferRef.current.push({
            content: data.content,
            sequence: data.sequence
          });
          
          // Process buffer to display messages in order
          processMessageBuffer();
        }
      } else if (data.done) {
        // Final processing of any remaining buffered messages
        processMessageBuffer();
        
        // Processing is complete
        setLoading(false);
      }
    });
    
    // Connection closed
    socketRef.current.addEventListener('close', () => {
      console.log('WebSocket Disconnected');
      setSocketConnected(false);
    });
    
    // Connection error
    socketRef.current.addEventListener('error', (error) => {
      console.error('WebSocket Error:', error);
      if (connectionAttempted) {
        message.error('连接服务器失败，请刷新页面重试');
      }
      setSocketConnected(false);
    });
    
    // Clean up on unmount
    return () => {
      clearTimeout(connectionTimeout);
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, []);

  const onFinish = (values: any) => {
    if (!socketConnected) {
      message.error('未连接到服务器，请刷新页面重试');
      return;
    }
    
    // Reset states
    setLoading(true);
    setResponseMessage('');
    setError(null);
    messageBufferRef.current = [];
    lastProcessedSequenceRef.current = -1;
    
    // Send data to server via WebSocket
    const requestData = {
      action: 'predict',
      data: values
    };
    
    socketRef.current?.send(JSON.stringify(requestData));
    console.log('Form values sent:', values);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <Title level={2}>高考志愿推荐</Title>
      <Paragraph className="mb-6">
        请填写您的高考信息，我们将为您推荐最适合的大学和专业。
      </Paragraph>
      
      <Card className="mb-6">
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
        >
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item
                name="model"
                label="选择模型"
                initialValue={modelOptions[0].value}
              >
                <Select>
                  {modelOptions.map(option => (
                    <Option key={option.value} value={option.value}>
                      {option.label}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          
          <Form.Item
            name="score"
            label="高考分数"
            rules={[{ required: true, message: '请输入高考分数' }]}
          >
            <Input type="number" placeholder="例如：650" />
          </Form.Item>
          
          <Form.Item
            name="ranking"
            label="省内排位"
            rules={[{ required: true, message: '请输入省内排位' }]}
          >
            <Input type="number" placeholder="例如：5000" />
          </Form.Item>
          
          <Form.Item
            name="province"
            label="所在省份"
            rules={[{ required: true, message: '请选择所在省份' }]}
          >
            <Select placeholder="选择省份">
              <Option value="beijing">北京</Option>
              <Option value="shanghai">上海</Option>
              <Option value="guangdong">广东</Option>
              <Option value="jiangsu">江苏</Option>
              <Option value="zhejiang">浙江</Option>
              <Option value="sichuan">四川</Option>
              {/* Add more provinces as needed */}
            </Select>
          </Form.Item>
          
          <Form.Item
            name="preferredCity"
            label="期望城市"
            initialValue={["no_preference"]}
          >
            <Select mode="multiple" placeholder="选择期望城市（可多选）">
              <Option value="no_preference">不限</Option>
              <Option value="beijing">北京</Option>
              <Option value="shanghai">上海</Option>
              <Option value="guangzhou">广州</Option>
              <Option value="shenzhen">深圳</Option>
              <Option value="hangzhou">杭州</Option>
              <Option value="nanjing">南京</Option>
              <Option value="chengdu">成都</Option>
              <Option value="wuhan">武汉</Option>
              <Option value="xian">西安</Option>
              <Option value="tianjin">天津</Option>
              <Option value="chongqing">重庆</Option>
              <Option value="suzhou">苏州</Option>
              <Option value="other">其他</Option>
              <Option value="eastnorthchina">--东北--</Option>
              <Option value="westnorthchina">--西北--</Option>
              <Option value="westsouthchina">--西南--</Option>
              <Option value="southeastchina">--东南--</Option>
              <Option value="northchina">--华北--</Option>
              <Option value="eastchina">--华东--</Option>
              <Option value="southchina">--华南--</Option>
            </Select>
          </Form.Item>
          
          <Form.Item
            name="examSubjects"
            label="考试科目"
            rules={[{ required: true, message: '请选择考试科目' }]}
          >
            <Select mode="multiple" placeholder="选择考试科目（可多选）">
              <Option value="physics">物理</Option>
              <Option value="chemistry">化学</Option>
              <Option value="biology">生物</Option>
              <Option value="geography">地理</Option>
              <Option value="history">历史</Option>
              <Option value="politics">政治</Option>
            </Select>
          </Form.Item>
          
          <Form.Item
            name="interests"
            label="兴趣方向"
            rules={[{ required: true, message: '请选择兴趣方向' }]}
          >
            <Select mode="multiple" placeholder="选择兴趣方向（可多选）">
              <Option value="computer">计算机</Option>
              <Option value="finance">金融经济</Option>
              <Option value="medicine">医学</Option>
              <Option value="engineering">工程</Option>
              <Option value="literature">文学</Option>
              <Option value="art">艺术</Option>
              <Option value="science">基础科学</Option>
              <Option value="law">法律</Option>
              <Option value="business">商学</Option>
              <Option value="education">教育</Option>
              <Option value="environment">环境科学</Option>
              <Option value="technology">技术</Option>
              <Option value="agriculture">农业</Option>
              <Option value="other">其他</Option>
              {/* Add more interests as needed */}
            </Select>
          </Form.Item>
          
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} disabled={!socketConnected}>
              获取推荐
            </Button>
            {connectionAttempted && !socketConnected && <span className="ml-2 text-red-500">未连接到服务器</span>}
          </Form.Item>
        </Form>
      </Card>
      
      {error && (
        <Card className="mb-6 border-red-500">
          <div className="text-red-500">{error}</div>
        </Card>
      )}
      
      {responseMessage && (
        <Card className="mb-6">
          <div className="markdown-content">
            <ReactMarkdown>{responseMessage}</ReactMarkdown>
          </div>
        </Card>
      )}
    </div>
  );
};

export default CollegeRecommendationForm;