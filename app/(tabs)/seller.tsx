import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  Image,
  Modal,
  FlatList,
  Platform,
} from 'react-native';
import { Plus, Clock, Package, Camera, X, Check, Trash2, RotateCcw, Truck, Archive, ChevronDown, ChevronUp, Tag, ShoppingCart } from 'lucide-react-native';
import { supabase, Product, sendAuctionNotifications, uploadProductImage } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { CountdownTimer } from '../../components/CountdownTimer';
import { WebCamera } from '../../components/WebCamera';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';

interface ProductWithCount extends Product {
  bid_count?: number;
  winner_name?: string;
  delivery_status?: string | null;
  delivery_id?: string | null;
  pending_delivery_id?: string | null;
  pending_delivery_count?: number;
  is_archived?: boolean;
}

interface ArchivedRecord {
  id: string;
  product_id: string;
  completed_summary: string;
  completed_at: string;
  product_name: string;
}

const SAMPLE_IMAGES = [
  { id: '1', url: 'https://images.pexels.com/photos/90946/pexels-photo-90946.jpeg?w=400', label: '電子產品' },
  { id: '2', url: 'https://images.pexels.com/photos/303383/pexels-photo-303383.jpeg?w=400', label: '鍵盤' },
  { id: '3', url: 'https://images.pexels.com/photos/934070/pexels-photo-934070.jpeg?w=400', label: '背包' },
  { id: '4', url: 'https://images.pexels.com/photos/13894608/pexels-photo-13894608.jpeg?w=400', label: '音響' },
  { id: '5', url: 'https://images.pexels.com/photos/225503/pexels-photo-225503.jpeg?w=400', label: '相機' },
  { id: '6', url: 'https://images.pexels.com/photos/7860091/pexels-photo-7860091.jpeg?w=400', label: '珠寶' },
  { id: '7', url: 'https://images.pexels.com/photos/19090/pexels-photo.jpeg?w=400', label: '手錶' },
  { id: '8', url: 'https://images.pexels.com/photos/1591557/pexels-photo-1591557.jpeg?w=400', label: '藝術品' },
];

export default function SellerPage() {
  const router = useRouter();
  const [products, setProducts] = useState<ProductWithCount[]>([]);
  const [archivedRecords, setArchivedRecords] = useState<ArchivedRecord[]>([]);
  const [archiveExpanded, setArchiveExpanded] = useState(false);
  const [relistTarget, setRelistTarget] = useState<Product | null>(null);
  const [relistDuration, setRelistDuration] = useState('60');
  const [relistSubmitting, setRelistSubmitting] = useState(false);
  const [endTarget, setEndTarget] = useState<Product | null>(null);
  const [endSubmitting, setEndSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState('60');
  const [reservePrice, setReservePrice] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [selectedImage, setSelectedImage] = useState(SAMPLE_IMAGES[0].url);
  const [imagePickerVisible, setImagePickerVisible] = useState(false);
  const [webCameraVisible, setWebCameraVisible] = useState(false);
  // Listing type
  const [listingType, setListingType] = useState<'auction' | 'direct'>('auction');
  const [directPrice, setDirectPrice] = useState('');
  const [stockQuantity, setStockQuantity] = useState('1');
  const { user, currentRole } = useAuth();

  useFocusEffect(
    useCallback(() => {
      if (user && currentRole === 'seller') {
        fetchProducts();
      }
    }, [user, currentRole])
  );

  const fetchArchivedRecords = async (sellerId: string) => {
    const { data: archivedProducts } = await supabase
      .from('products')
      .select('id, name')
      .eq('seller_id', sellerId)
      .eq('is_archived', true);

    if ((archivedProducts || []).length === 0) {
      setArchivedRecords([]);
      return;
    }

    const archivedIds = (archivedProducts || []).map(p => p.id);
    const { data: deliveries } = await supabase
      .from('deliveries')
      .select('id, product_id, completed_summary, completed_at')
      .in('product_id', archivedIds)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false });

    const nameMap: Record<string, string> = {};
    (archivedProducts || []).forEach(p => { nameMap[p.id] = p.name; });

    // For archived products without a delivery record, still show them
    const deliveredIds = new Set((deliveries || []).map(d => d.product_id));
    const missingDelivery = (archivedProducts || [])
      .filter(p => !deliveredIds.has(p.id))
      .map(p => ({
        id: `no-delivery-${p.id}`,
        product_id: p.id,
        completed_summary: `【${p.name}】\n（交付記錄已封存）`,
        completed_at: '',
        product_name: p.name,
      }));

    setArchivedRecords([
      ...(deliveries || []).map(d => ({
        id: d.id,
        product_id: d.product_id,
        completed_summary: d.completed_summary || `【${nameMap[d.product_id] || '商品'}】\n（交付已完成）`,
        completed_at: d.completed_at || '',
        product_name: nameMap[d.product_id] || '未知商品',
      })),
      ...missingDelivery,
    ]);
  };

  const fetchProducts = async () => {
    if (!user) return;
    try {
      const { data: productData } = await supabase
        .from('products')
        .select('id, name, status, end_time, winner_id, winning_amount, seller_id, created_at, is_archived, reserve_price, is_direct_buy, direct_price, stock_quantity, image_url')
        .eq('seller_id', user.id)
        .eq('is_archived', false)
        .order('created_at', { ascending: false });

      const productIds = (productData || []).map(p => p.id);
      const { data: bidCounts } = await supabase
        .from('bids')
        .select('product_id')
        .in('product_id', productIds.length > 0 ? productIds : ['00000000-0000-0000-0000-000000000000']);

      const bidCountMap = new Map<string, number>();
      (bidCounts || []).forEach((b) => {
        const count = bidCountMap.get(b.product_id) || 0;
        bidCountMap.set(b.product_id, count + 1);
      });

      const winnerIds = (productData || []).filter(p => p.winner_id).map(p => p.winner_id);
      let winnerMap: Record<string, string> = {};

      if (winnerIds.length > 0) {
        const { data: winners } = await supabase
          .from('profiles')
          .select('id, name')
          .in('id', winnerIds as string[]);

        (winners || []).forEach((w) => {
          winnerMap[w.id] = w.name;
        });
      }

      // Fetch delivery status and ID for ended auction products with a winner
      const endedWithWinnerIds = (productData || [])
        .filter(p => p.status === 'ended' && p.winner_id && !p.is_direct_buy)
        .map(p => p.id);

      const deliveryStatusMap = new Map<string, string>();
      const deliveryIdMap = new Map<string, string>();
      const completedProductIds = new Set<string>();

      if (endedWithWinnerIds.length > 0) {
        const { data: deliveryRows } = await supabase
          .from('deliveries')
          .select('id, product_id, status')
          .in('product_id', endedWithWinnerIds)
          .eq('is_direct_buy', false);

        (deliveryRows || []).forEach(d => {
          deliveryStatusMap.set(d.product_id, d.status);
          deliveryIdMap.set(d.product_id, d.id);
          if (d.status === 'completed') {
            completedProductIds.add(d.product_id);
          }
        });
      }

      // Fetch pending direct buy deliveries (one per purchase, may be many per product)
      const directBuyIds = (productData || [])
        .filter(p => p.is_direct_buy && !p.is_archived)
        .map(p => p.id);

      const pendingDeliveryIdMap = new Map<string, string>();
      const pendingDeliveryCountMap = new Map<string, number>();

      if (directBuyIds.length > 0) {
        const { data: pendingDeliveries } = await supabase
          .from('deliveries')
          .select('id, product_id, status, created_at')
          .in('product_id', directBuyIds)
          .in('status', ['pending', 'shipped', 'delivered'])
          .order('created_at', { ascending: true });

        (pendingDeliveries || []).forEach(d => {
          if (!pendingDeliveryIdMap.has(d.product_id)) {
            pendingDeliveryIdMap.set(d.product_id, d.id);
          }
          pendingDeliveryCountMap.set(d.product_id, (pendingDeliveryCountMap.get(d.product_id) || 0) + 1);
        });
      }

      // Auto-archive any products whose delivery is completed but not yet archived
      if (completedProductIds.size > 0) {
        const toArchive = [...completedProductIds].filter(pid => {
          const p = (productData || []).find(x => x.id === pid);
          return p && !p.is_archived;
        });
        if (toArchive.length > 0) {
          await supabase.from('products').update({ is_archived: true }).in('id', toArchive);
          // Re-fetch to get updated is_archived flags
          const { data: refreshed } = await supabase
            .from('products')
            .select('id, name, status, end_time, winner_id, winning_amount, seller_id, created_at, is_archived, reserve_price, is_direct_buy, direct_price, stock_quantity, image_url')
            .eq('seller_id', user.id)
            .eq('is_archived', false)
            .order('created_at', { ascending: false });
          // Use refreshed data from here
          const productsWithBids = (refreshed || []).map((p) => ({
            ...p,
            bid_count: bidCountMap.get(p.id) || 0,
            winner_name: p.winner_id ? winnerMap[p.winner_id] : undefined,
            delivery_status: deliveryStatusMap.get(p.id) ?? null,
            delivery_id: deliveryIdMap.get(p.id) ?? null,
            pending_delivery_id: pendingDeliveryIdMap.get(p.id) ?? null,
            pending_delivery_count: pendingDeliveryCountMap.get(p.id) ?? 0,
          }));
          setProducts(productsWithBids);
          // Skip the normal setProducts below by jumping to archive fetch
          await fetchArchivedRecords(user.id);
          return;
        }
      }

      const productsWithBids = (productData || []).map((p) => ({
        ...p,
        bid_count: bidCountMap.get(p.id) || 0,
        winner_name: p.winner_id ? winnerMap[p.winner_id] : undefined,
        delivery_status: deliveryStatusMap.get(p.id) ?? null,
        delivery_id: deliveryIdMap.get(p.id) ?? null,
        pending_delivery_id: pendingDeliveryIdMap.get(p.id) ?? null,
        pending_delivery_count: pendingDeliveryCountMap.get(p.id) ?? 0,
      }));

      setProducts(productsWithBids);

      await fetchArchivedRecords(user.id);
    } catch (error) {
      console.warn('Seller fetchProducts error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddProduct = async () => {
    if (!user) return;

    if (user.is_blocked) {
      Alert.alert('帳號已停用', `您的帳號已被管理員停用，無法上架商品。\n原因：${user.blocked_reason || '違反使用規範'}`);
      return;
    }

    if (!name.trim()) {
      Alert.alert('錯誤', '請輸入商品名稱');
      return;
    }

    if (listingType === 'auction') {
      const durationMinutes = parseInt(duration, 10);
      if (isNaN(durationMinutes) || durationMinutes <= 0) {
        Alert.alert('錯誤', '請輸入有效的結標時間（分鐘）');
        return;
      }
    } else {
      const price = parseInt(directPrice, 10);
      if (isNaN(price) || price <= 0) {
        Alert.alert('錯誤', '請輸入有效的直購價格');
        return;
      }
      const qty = parseInt(stockQuantity, 10);
      if (isNaN(qty) || qty <= 0) {
        Alert.alert('錯誤', '請輸入有效的庫存數量');
        return;
      }
    }

    const endTime = new Date();
    if (listingType === 'auction') {
      endTime.setMinutes(endTime.getMinutes() + parseInt(duration, 10));
    } else {
      // Direct buy: set far-future end_time (never expires by timer)
      endTime.setFullYear(endTime.getFullYear() + 10);
    }

    setSubmitting(true);
    try {
      const imageUrl = await uploadProductImage(selectedImage);

      const payload: Record<string, any> = {
        name: name.trim(),
        description: description.trim(),
        seller_id: user.id,
        end_time: endTime.toISOString(),
        image_url: imageUrl,
        status: 'active',
        is_approved: true,
        is_direct_buy: listingType === 'direct',
      };

      if (listingType === 'auction') {
        payload.reserve_price = parseInt(reservePrice, 10) || 0;
      } else {
        payload.direct_price = parseInt(directPrice, 10);
        payload.stock_quantity = parseInt(stockQuantity, 10) || 1;
      }

      const { error } = await supabase.from('products').insert(payload);
      if (error) throw error;

      setName('');
      setDescription('');
      setDuration('60');
      setReservePrice('0');
      setDirectPrice('');
      setStockQuantity('1');
      setSelectedImage(SAMPLE_IMAGES[0].url);
      fetchProducts();
    } catch (error) {
      console.error('Error adding product:', error);
      Alert.alert('錯誤', '新增商品失敗');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEndAuction = (product: Product) => {
    setEndTarget(product);
  };

  const confirmEndAuction = async () => {
    if (!endTarget) return;
    setEndSubmitting(true);
    try {
      const { data: allBids } = await supabase
        .from('bids')
        .select('*, bidder:profiles!bidder_id(name, id)')
        .eq('product_id', endTarget.id)
        .order('amount', { ascending: false });

      const winningBid = allBids?.[0];
      const winnerId = winningBid?.bidder_id ?? null;
      const winningAmount = winningBid?.amount ?? null;

      const { error } = await supabase
        .from('products')
        .update({
          status: 'ended',
          winner_id: winnerId,
          winning_amount: winningAmount,
        })
        .eq('id', endTarget.id);

      if (error) throw error;

      const bidderIds = (allBids || []).map((b: any) => b.bidder_id).filter(Boolean);
      if (bidderIds.length > 0) {
        await sendAuctionNotifications(endTarget.id, endTarget.name, winnerId, winningAmount, bidderIds);
      }

      setEndTarget(null);
      fetchProducts();
    } catch (error) {
      console.error('Error ending auction:', error);
    } finally {
      setEndSubmitting(false);
    }
  };

  const handleRelist = (product: Product) => {
    setRelistDuration('60');
    setRelistTarget(product);
  };

  const confirmRelist = async () => {
    if (!relistTarget) return;
    const minutes = parseInt(relistDuration, 10);
    if (isNaN(minutes) || minutes <= 0) return;
    setRelistSubmitting(true);
    try {
      const endTime = new Date();
      endTime.setMinutes(endTime.getMinutes() + minutes);
      const { error } = await supabase
        .from('products')
        .update({
          status: 'active',
          end_time: endTime.toISOString(),
          winner_id: null,
          winning_amount: null,
        })
        .eq('id', relistTarget.id);
      if (error) throw error;
      setRelistTarget(null);
      fetchProducts();
    } catch (error) {
      console.error('Error relisting:', error);
    } finally {
      setRelistSubmitting(false);
    }
  };

  const handleDelete = (product: Product) => {
    setDeleteTarget(product);
  };

  const confirmDelete = async () => {
    if (!deleteTarget || !user) return;
    if (user.id !== deleteTarget.seller_id) return;
    setDeleteSubmitting(true);
    try {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', deleteTarget.id);
      if (error) throw error;
      setDeleteTarget(null);
      fetchProducts();
    } catch (error) {
      console.error('Error deleting:', error);
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const handleDelivery = (product: ProductWithCount, deliveryId?: string) => {
    const target = deliveryId || product.delivery_id || product.pending_delivery_id;
    if (!target) return;
    router.push({
      pathname: '/delivery/[id]' as any,
      params: { id: target },
    });
  };

  const openFilePicker = async () => {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = (e: any) => {
        const file = e.target?.files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            if (ev.target?.result) {
              setSelectedImage(ev.target.result as string);
              setImagePickerVisible(false);
            }
          };
          reader.readAsDataURL(file);
        }
      };
      input.click();
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('需要權限', '請允許存取相簿以選擇圖片');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
        base64: true,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const dataUrl = asset.base64
          ? `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`
          : asset.uri;
        setSelectedImage(dataUrl);
        setImagePickerVisible(false);
      }
    }
  };

  const pickImage = () => {
    setImagePickerVisible(true);
  };

  const ImagePickerModal = () => (
    <Modal
      visible={imagePickerVisible}
      transparent
      animationType="slide"
      onRequestClose={() => setImagePickerVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>選擇商品圖片</Text>
            <TouchableOpacity onPress={() => setImagePickerVisible(false)}>
              <X size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={styles.pickButtonRow}>
            <TouchableOpacity
              style={styles.pickButton}
              onPress={() => { setImagePickerVisible(false); setWebCameraVisible(true); }}
            >
              <Camera size={22} color="#00D4AA" />
              <Text style={styles.pickButtonText}>拍照</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.pickButton}
              onPress={openFilePicker}
            >
              <Package size={22} color="#00D4AA" />
              <Text style={styles.pickButtonText}>從相簿選擇</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.dividerText}>或選擇範例圖片</Text>

          <FlatList
            data={SAMPLE_IMAGES}
            numColumns={2}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.imageOption,
                  selectedImage === item.url && styles.imageOptionSelected
                ]}
                onPress={() => {
                  setSelectedImage(item.url);
                  setImagePickerVisible(false);
                }}
              >
                <Image source={{ uri: item.url }} style={styles.previewImage} />
                <Text style={styles.imageLabel}>{item.label}</Text>
                {selectedImage === item.url && (
                  <View style={styles.checkMark}>
                    <Check size={20} color="#fff" />
                  </View>
                )}
              </TouchableOpacity>
            )}
          />
        </View>
      </View>
    </Modal>
  );

  if (currentRole !== 'seller') {
    return (
      <View style={styles.unauthorizedContainer}>
        <Package size={48} color="#333" />
        <Text style={styles.unauthorizedTitle}>需要賣家身份</Text>
        <Text style={styles.unauthorizedText}>請切換至賣家身份以使用此功能</Text>
      </View>
    );
  }

  const pendingProducts: ProductWithCount[] = [];
  const activeAuctionProducts = products.filter(p => p.status === 'active' && !p.is_direct_buy);
  const activeDirectProducts = products.filter(p => p.status === 'active' && p.is_direct_buy);
  const endedProducts = products.filter(p => p.status === 'ended');
  // Sold = auction ended with winner, delivery NOT completed, NOT archived
  const soldProducts = endedProducts.filter(
    p => !p.is_direct_buy
      && p.winning_amount && p.winning_amount > 0
      && p.delivery_status !== 'completed'
      && !p.is_archived
  );
  const unsoldProducts = endedProducts.filter(p => !p.winning_amount);

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <ImagePickerModal />

      {/* End Auction Confirm Modal */}
      <Modal visible={!!endTarget} transparent animationType="fade" onRequestClose={() => setEndTarget(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModalContent}>
            <TouchableOpacity style={styles.relistModalClose} onPress={() => setEndTarget(null)}>
              <X size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.confirmModalTitle}>確認結標</Text>
            <Text style={styles.confirmModalSubtitle}>{endTarget?.name}</Text>
            <Text style={styles.confirmModalBody}>確定要立即結束此競標嗎？{'\n'}此操作無法撤銷。</Text>
            <View style={styles.confirmButtons}>
              <TouchableOpacity style={styles.confirmCancelBtn} onPress={() => setEndTarget(null)}>
                <Text style={styles.confirmCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmEndBtn, endSubmitting && { opacity: 0.6 }]}
                onPress={confirmEndAuction}
                disabled={endSubmitting}
              >
                {endSubmitting ? <ActivityIndicator color="#fff" size="small" /> : (
                  <Text style={styles.confirmEndText}>確定結標</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete Confirm Modal */}
      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModalContent}>
            <TouchableOpacity style={styles.relistModalClose} onPress={() => setDeleteTarget(null)}>
              <X size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.confirmModalTitle}>確認下架</Text>
            <Text style={styles.confirmModalSubtitle}>{deleteTarget?.name}</Text>
            <Text style={styles.confirmModalBody}>確定要下架此商品嗎？{'\n'}此操作無法撤銷。</Text>
            <View style={styles.confirmButtons}>
              <TouchableOpacity style={styles.confirmCancelBtn} onPress={() => setDeleteTarget(null)}>
                <Text style={styles.confirmCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmDeleteBtn, deleteSubmitting && { opacity: 0.6 }]}
                onPress={confirmDelete}
                disabled={deleteSubmitting}
              >
                {deleteSubmitting ? <ActivityIndicator color="#fff" size="small" /> : (
                  <Text style={styles.confirmDeleteText}>確定下架</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Relist Modal */}
      <Modal visible={!!relistTarget} transparent animationType="fade" onRequestClose={() => setRelistTarget(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.relistModalContent}>
            <TouchableOpacity style={styles.relistModalClose} onPress={() => setRelistTarget(null)}>
              <X size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.relistModalTitle}>重新上架</Text>
            <Text style={styles.relistModalSubtitle}>{relistTarget?.name}</Text>
            <Text style={styles.relistModalLabel}>設定新的競標時間（分鐘）</Text>
            <TextInput
              style={styles.relistModalInput}
              value={relistDuration}
              onChangeText={setRelistDuration}
              keyboardType="numeric"
              placeholder="例如: 60"
              placeholderTextColor="#444"
            />
            <Text style={styles.relistModalHint}>輸入 60 = 1 小時後結標</Text>
            <TouchableOpacity
              style={[styles.relistModalConfirm, relistSubmitting && { opacity: 0.6 }]}
              onPress={confirmRelist}
              disabled={relistSubmitting}
            >
              {relistSubmitting ? <ActivityIndicator color="#000" /> : (
                <Text style={styles.relistModalConfirmText}>確認重新上架</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <WebCamera
        visible={webCameraVisible}
        onCapture={(dataUrl) => { setSelectedImage(dataUrl); setWebCameraVisible(false); }}
        onClose={() => setWebCameraVisible(false)}
      />

      <View style={styles.addForm}>
        <View style={styles.formHeader}>
          <Plus size={24} color="#00D4AA" />
          <Text style={styles.formTitle}>新增商品</Text>
        </View>

        <View style={styles.formContent}>
          {/* Listing type toggle */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>上架類型</Text>
            <View style={styles.typeToggle}>
              <TouchableOpacity
                style={[styles.typeOption, listingType === 'auction' && styles.typeOptionActiveAuction]}
                onPress={() => setListingType('auction')}
              >
                <Clock size={16} color={listingType === 'auction' ? '#000' : '#00D4AA'} />
                <Text style={[styles.typeOptionText, listingType === 'auction' && styles.typeOptionTextActive]}>競價廳</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.typeOption, listingType === 'direct' && styles.typeOptionActiveDirect]}
                onPress={() => setListingType('direct')}
              >
                <Tag size={16} color={listingType === 'direct' ? '#000' : '#FFD700'} />
                <Text style={[styles.typeOptionText, listingType === 'direct' && styles.typeOptionTextActiveDirect]}>直購廳</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>商品名稱 *</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="輸入商品名稱"
              placeholderTextColor="#444"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>商品圖片</Text>
            <TouchableOpacity
              style={styles.imageSelector}
              onPress={pickImage}
            >
              <Image source={{ uri: selectedImage }} style={styles.selectedImage} />
              <View style={styles.imageSelectorOverlay}>
                <Camera size={24} color="#fff" />
                <Text style={styles.imageSelectorText}>點擊選擇或拍攝圖片</Text>
              </View>
            </TouchableOpacity>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>商品描述</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="輸入商品詳細描述..."
              placeholderTextColor="#444"
              multiline
              numberOfLines={3}
            />
          </View>

          {/* Auction-only fields */}
          {listingType === 'auction' && (
            <>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>結標時間（分鐘）</Text>
                <TextInput
                  style={styles.input}
                  value={duration}
                  onChangeText={setDuration}
                  placeholder="例如: 60"
                  placeholderTextColor="#444"
                  keyboardType="numeric"
                />
                <Text style={styles.hintText}>輸入 60 表示 1 小時後結標</Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>賣家底價（NT$）</Text>
                <TextInput
                  style={styles.input}
                  value={reservePrice}
                  onChangeText={setReservePrice}
                  placeholder="0"
                  placeholderTextColor="#444"
                  keyboardType="numeric"
                />
                <Text style={styles.hintText}>設為 0 表示無底價限制，買家出任何金額均可</Text>
              </View>
            </>
          )}

          {/* Direct-buy-only fields */}
          {listingType === 'direct' && (
            <>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>直購價格（NT$） *</Text>
                <TextInput
                  style={[styles.input, styles.directPriceInput]}
                  value={directPrice}
                  onChangeText={setDirectPrice}
                  placeholder="輸入售價"
                  placeholderTextColor="#444"
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>庫存數量 *</Text>
                <TextInput
                  style={styles.input}
                  value={stockQuantity}
                  onChangeText={setStockQuantity}
                  placeholder="1"
                  placeholderTextColor="#444"
                  keyboardType="numeric"
                />
                <Text style={styles.hintText}>每筆訂單購買 1 件，庫存耗盡後自動下架</Text>
              </View>
            </>
          )}

          <TouchableOpacity
            style={[styles.submitButton, listingType === 'direct' && styles.submitButtonDirect, submitting && styles.disabled]}
            onPress={handleAddProduct}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#000" />
            ) : (
              <>
                {listingType === 'auction' ? <Package size={20} color="#000" /> : <ShoppingCart size={20} color="#000" />}
                <Text style={styles.submitText}>{listingType === 'auction' ? '上架至競價廳' : '上架至直購廳'}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Active Auction Products */}
      {activeAuctionProducts.length > 0 && (
        <View style={styles.productsSection}>
          <Text style={styles.sectionTitle}>競價廳 - 競標中 ({activeAuctionProducts.length})</Text>
          {activeAuctionProducts.map((item) => (
            <View key={item.id} style={styles.productCard}>
              <View style={styles.productHeader}>
                <Image source={{ uri: item.image_url }} style={styles.productImage} />
                <View style={styles.productInfo}>
                  <Text style={styles.productName}>{item.name}</Text>
                  <View style={styles.productMeta}>
                    <Clock size={14} color="#888" />
                    <CountdownTimer endTime={item.end_time || ''} size="small" isEnded={false} />
                  </View>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: 'rgba(0, 212, 170, 0.2)' }]}>
                  <Text style={[styles.statusText, { color: '#00D4AA' }]}>競標中</Text>
                </View>
              </View>

              <Text style={styles.productDesc} numberOfLines={2}>
                {item.description || '無描述'}
              </Text>

              <View style={styles.productFooter}>
                <Text style={styles.bidInfoText}>{item.bid_count || 0} 人出價</Text>
                <TouchableOpacity
                  style={styles.endButton}
                  onPress={() => handleEndAuction(item)}
                >
                  <Text style={styles.endButtonText}>立即結標</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Active Direct Products */}
      {activeDirectProducts.length > 0 && (
        <View style={styles.productsSection}>
          <Text style={styles.sectionTitleDirect}>直購廳 - 販售中 ({activeDirectProducts.length})</Text>
          {activeDirectProducts.map((item) => (
            <View key={item.id} style={styles.productCardDirect}>
              <View style={styles.productHeader}>
                <Image source={{ uri: item.image_url }} style={styles.productImage} />
                <View style={styles.productInfo}>
                  <Text style={styles.productName}>{item.name}</Text>
                  <Text style={styles.directPriceLabel}>NT$ {(item.direct_price || 0).toLocaleString()}</Text>
                  <View style={styles.stockRow}>
                    <Text style={styles.stockLabel}>庫存：</Text>
                    <Text style={[styles.stockValue, (item.stock_quantity || 0) <= 0 && styles.stockEmpty]}>
                      {item.stock_quantity ?? 1} 件
                    </Text>
                  </View>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: 'rgba(255, 215, 0, 0.2)' }]}>
                  <Text style={[styles.statusText, { color: '#FFD700' }]}>直購中</Text>
                </View>
              </View>

              {item.description ? (
                <Text style={styles.productDesc} numberOfLines={2}>{item.description}</Text>
              ) : null}

              <View style={styles.productFooter}>
                {(item.pending_delivery_count ?? 0) > 0 && (
                  <TouchableOpacity
                    style={styles.deliveryButton}
                    onPress={() => handleDelivery(item)}
                  >
                    <Truck size={18} color="#fff" />
                    <Text style={styles.deliveryButtonText}>
                      待出貨 {item.pending_delivery_count} 筆
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => handleDelete(item)}
                >
                  <Trash2 size={18} color="#FF6B6B" />
                  <Text style={styles.deleteButtonText}>下架</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Sold Products - Need Delivery */}
      {soldProducts.length > 0 && (
        <View style={styles.productsSection}>
          <Text style={styles.sectionTitleGold}>已售出 - 待交付 ({soldProducts.length})</Text>
          {soldProducts.map((item) => (
            <View key={item.id} style={styles.productCardSold}>
              <View style={styles.productHeader}>
                <Image source={{ uri: item.image_url }} style={styles.productImage} />
                <View style={styles.productInfo}>
                  <Text style={styles.productName}>{item.name}</Text>
                  <Text style={styles.winnerText}>得標者: {item.winner_name}</Text>
                  <Text style={styles.amountText}>NT$ {(item.winning_amount || 0).toLocaleString()}</Text>
                </View>
              </View>

              <View style={styles.productFooter}>
                <TouchableOpacity
                  style={styles.deliveryButton}
                  onPress={() => handleDelivery(item)}
                >
                  <Truck size={18} color="#fff" />
                  <Text style={styles.deliveryButtonText}>進行交付</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Unsold Products */}
      {unsoldProducts.length > 0 && (
        <View style={styles.productsSection}>
          <Text style={styles.sectionTitleRed}>流標商品 ({unsoldProducts.length})</Text>
          {unsoldProducts.map((item) => (
            <View key={item.id} style={styles.productCardUnsold}>
              <View style={styles.productHeader}>
                <Image source={{ uri: item.image_url }} style={styles.productImage} />
                <View style={styles.productInfo}>
                  <Text style={styles.productName}>{item.name}</Text>
                  <Text style={styles.unsoldText}>無人得標</Text>
                </View>
              </View>

              <View style={styles.productFooter}>
                <TouchableOpacity
                  style={styles.relistButton}
                  onPress={() => handleRelist(item)}
                >
                  <RotateCcw size={18} color="#00D4AA" />
                  <Text style={styles.relistButtonText}>重新上架</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => handleDelete(item)}
                >
                  <Trash2 size={18} color="#FF6B6B" />
                  <Text style={styles.deleteButtonText}>下架</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {products.length === 0 && archivedRecords.length === 0 && !loading && (
        <View style={styles.productsSection}>
          <View style={styles.emptyState}>
            <Package size={40} color="#333" />
            <Text style={styles.emptyText}>尚未上架任何商品</Text>
          </View>
        </View>
      )}

      {/* Archived / Completed Delivery Records — lightweight text list */}
      {archivedRecords.length > 0 && (
        <View style={styles.productsSection}>
          <TouchableOpacity
            style={styles.archiveHeader}
            onPress={() => setArchiveExpanded(v => !v)}
            activeOpacity={0.7}
          >
            <View style={styles.archiveHeaderLeft}>
              <Archive size={18} color="#888" />
              <Text style={styles.archiveTitle}>已完成交付紀錄 ({archivedRecords.length})</Text>
            </View>
            {archiveExpanded
              ? <ChevronUp size={18} color="#888" />
              : <ChevronDown size={18} color="#888" />
            }
          </TouchableOpacity>

          {archiveExpanded && (
            <View style={styles.archiveList}>
              {archivedRecords.map((rec, idx) => (
                <View key={rec.id} style={[styles.archiveItem, idx < archivedRecords.length - 1 && styles.archiveItemBorder]}>
                  <View style={styles.archiveItemHeader}>
                    <Archive size={13} color="#555" />
                    <Text style={styles.archiveItemName}>{rec.product_name}</Text>
                    <Text style={styles.archiveItemDate}>
                      {rec.completed_at
                        ? new Date(rec.completed_at).toLocaleDateString('zh-TW')
                        : '—'
                      }
                    </Text>
                  </View>
                  <Text style={styles.archiveItemSummary}>{rec.completed_summary || '（無摘要）'}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D1A' },
  unauthorizedContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D0D1A', padding: 20 },
  unauthorizedTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginTop: 16, marginBottom: 8 },
  unauthorizedText: { fontSize: 14, color: '#888', textAlign: 'center' },
  addForm: {
    margin: 16,
    backgroundColor: '#1A1A2E',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 170, 0.2)',
  },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    backgroundColor: 'rgba(0, 212, 170, 0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 212, 170, 0.1)',
  },
  formTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  formContent: { padding: 16, gap: 16 },
  inputGroup: { gap: 8 },
  inputLabel: { fontSize: 13, color: '#888', fontWeight: '500' },
  input: {
    backgroundColor: '#0D0D1A',
    borderRadius: 8,
    padding: 14,
    color: '#fff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  hintText: { fontSize: 12, color: '#666', marginTop: 4 },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#00D4AA',
    padding: 16,
    borderRadius: 10,
    marginTop: 8,
  },
  disabled: { opacity: 0.6 },
  submitText: { color: '#000', fontSize: 16, fontWeight: '700' },
  imageSelector: {
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  selectedImage: { width: '100%', height: '100%' },
  imageSelectorOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  imageSelectorText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1A1A2E',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  pickButtonRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  pickButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(0, 212, 170, 0.1)',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 170, 0.3)',
  },
  pickButtonText: { color: '#00D4AA', fontSize: 14, fontWeight: '600' },
  dividerText: { color: '#888', fontSize: 13, textAlign: 'center', marginBottom: 16 },
  imageOption: {
    flex: 1,
    margin: 8,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    aspectRatio: 1,
  },
  imageOptionSelected: {
    borderWidth: 3,
    borderColor: '#00D4AA',
  },
  previewImage: { width: '100%', height: '100%' },
  imageLabel: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  checkMark: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#00D4AA',
    borderRadius: 12,
    padding: 4,
  },
  productsSection: { padding: 16, paddingTop: 0 },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 16 },
  sectionTitleGold: { fontSize: 20, fontWeight: '700', color: '#FFD700', marginBottom: 16 },
  sectionTitleRed: { fontSize: 20, fontWeight: '700', color: '#FF6B6B', marginBottom: 16 },
  productCard: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 170, 0.2)',
  },
  productCardSold: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.3)',
  },
  productCardUnsold: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.3)',
  },
  productHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10
  },
  productImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 12,
    objectFit: 'cover',
  } as any,
  productInfo: { flex: 1 },
  productName: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 6 },
  productMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  statusText: { fontSize: 12, fontWeight: '700' },
  productDesc: { fontSize: 13, color: '#888', marginBottom: 12, lineHeight: 18 },
  productFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
    paddingTop: 12,
  },
  bidInfoText: { fontSize: 14, color: '#fff', fontWeight: '600', flex: 1 },
  endButton: {
    backgroundColor: 'rgba(255, 107, 107, 0.2)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FF6B6B',
  },
  endButtonText: { color: '#FF6B6B', fontSize: 13, fontWeight: '600' },
  relistButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 212, 170, 0.2)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#00D4AA',
  },
  relistButtonText: { color: '#00D4AA', fontSize: 13, fontWeight: '600' },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 107, 107, 0.2)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FF6B6B',
  },
  deleteButtonText: { color: '#FF6B6B', fontSize: 13, fontWeight: '600' },
  deliveryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#00D4AA',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
  },
  deliveryButtonText: { color: '#000', fontSize: 13, fontWeight: '700' },
  winnerText: { fontSize: 13, color: '#FFD700', marginBottom: 4 },
  amountText: { fontSize: 16, color: '#00D4AA', fontWeight: '700' },
  unsoldText: { fontSize: 13, color: '#FF6B6B' },
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { color: '#666', fontSize: 15, marginTop: 12 },
  archiveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1A1A2E',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    marginBottom: 2,
  },
  archiveHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  archiveTitle: { color: '#888', fontSize: 15, fontWeight: '600' },
  archiveList: {
    backgroundColor: '#1A1A2E',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    overflow: 'hidden',
    marginTop: 4,
  },
  archiveItem: { padding: 14 },
  archiveItemBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  archiveItemHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  archiveItemName: { color: '#aaa', fontSize: 13, fontWeight: '700', flex: 1 },
  archiveItemDate: { color: '#555', fontSize: 11 },
  archiveItemSummary: { color: '#666', fontSize: 12, lineHeight: 18 },
  confirmModalContent: {
    backgroundColor: '#1A1A2E',
    borderRadius: 20,
    padding: 24,
    width: '85%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.3)',
  },
  confirmModalTitle: { color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 6, marginTop: 8 },
  confirmModalSubtitle: { color: '#00D4AA', fontSize: 14, textAlign: 'center', marginBottom: 12 },
  confirmModalBody: { color: '#ccc', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  confirmButtons: { flexDirection: 'row', gap: 12 },
  confirmCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
  },
  confirmCancelText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  confirmEndBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#FF6B6B',
    alignItems: 'center',
  },
  confirmEndText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  confirmDeleteBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#FF6B6B',
    alignItems: 'center',
  },
  confirmDeleteText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  relistModalContent: {
    backgroundColor: '#1A1A2E',
    borderRadius: 20,
    padding: 24,
    width: '85%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: 'rgba(0,212,170,0.3)',
  },
  relistModalClose: { position: 'absolute', top: 16, right: 16, zIndex: 1 },
  relistModalTitle: { color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 6, marginTop: 8 },
  relistModalSubtitle: { color: '#00D4AA', fontSize: 14, textAlign: 'center', marginBottom: 20 },
  relistModalLabel: { color: '#888', fontSize: 13, marginBottom: 8 },
  relistModalInput: {
    backgroundColor: '#0D0D1A',
    borderRadius: 8,
    padding: 14,
    color: '#fff',
    fontSize: 18,
    borderWidth: 1,
    borderColor: 'rgba(0,212,170,0.4)',
    marginBottom: 8,
  },
  relistModalHint: { color: '#666', fontSize: 12, marginBottom: 20 },
  relistModalConfirm: {
    backgroundColor: '#00D4AA',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  relistModalConfirmText: { color: '#000', fontSize: 15, fontWeight: '700' },
  // Listing type toggle
  typeToggle: {
    flexDirection: 'row',
    gap: 10,
  },
  typeOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  typeOptionActiveAuction: {
    backgroundColor: '#00D4AA',
    borderColor: '#00D4AA',
  },
  typeOptionActiveDirect: {
    backgroundColor: '#FFD700',
    borderColor: '#FFD700',
  },
  typeOptionText: { fontSize: 14, fontWeight: '700', color: '#888' },
  typeOptionTextActive: { color: '#000' },
  typeOptionTextActiveDirect: { color: '#000' },
  directPriceInput: { borderColor: 'rgba(255,215,0,0.4)' },
  submitButtonDirect: { backgroundColor: '#FFD700' },
  // Direct product card
  sectionTitleDirect: { fontSize: 20, fontWeight: '700', color: '#FFD700', marginBottom: 16 },
  productCardDirect: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.25)',
  },
  directPriceLabel: { fontSize: 15, fontWeight: '800', color: '#FFD700', marginBottom: 4 },
  stockRow: { flexDirection: 'row', alignItems: 'center' },
  stockLabel: { fontSize: 12, color: '#888' },
  stockValue: { fontSize: 12, fontWeight: '700', color: '#00D4AA' },
  stockEmpty: { color: '#FF6B6B' },
});
